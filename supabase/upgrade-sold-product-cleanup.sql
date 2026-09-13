-- 已售罄商品保留 7 天后自动清理
-- 商品码台账 product_code_registry 不会被删除，因此已用商品码永不复用。
-- 在 Supabase Dashboard -> SQL Editor 中执行一次。

create extension if not exists pg_cron;

alter table public.products
  add column if not exists sold_at timestamptz;

-- 现有已售罄商品从本次升级开始计算 7 天，避免升级后被立即删除。
update public.products
set sold_at = now()
where status = 'sold' and sold_at is null;

create index if not exists products_sold_cleanup_idx
  on public.products(status, sold_at);

create or replace function public.track_product_sold_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'sold' then
    if tg_op = 'INSERT' or old.status is distinct from 'sold' or old.sold_at is null then
      new.sold_at := now();
    end if;
  else
    new.sold_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists products_track_sold_at on public.products;
create trigger products_track_sold_at
before insert or update of status on public.products
for each row execute function public.track_product_sold_at();

create or replace function public.cleanup_expired_sold_products()
returns integer
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_product record;
  v_storage_path text;
  v_deleted integer := 0;
begin
  for v_product in
    select id, image_url
    from public.products
    where status = 'sold'
      and sold_at <= now() - interval '7 days'
  loop
    -- 只清理由本站 product-images 桶上传的图片；外部图片 URL 无需处理。
    v_storage_path := substring(v_product.image_url from '/storage/v1/object/public/product-images/(.*)$');
    if v_storage_path is not null and v_storage_path <> '' then
      delete from storage.objects
      where bucket_id = 'product-images' and name = v_storage_path;
    end if;

    delete from public.products where id = v_product.id;
    v_deleted := v_deleted + 1;
  end loop;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_expired_sold_products() from public;

-- 每天凌晨 03:17 执行一次。重复执行本脚本会替换旧任务，不会创建多个任务。
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'delete-sold-products-after-seven-days'
  limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'delete-sold-products-after-seven-days',
    '17 3 * * *',
    'select public.cleanup_expired_sold_products();'
  );
end;
$$;
