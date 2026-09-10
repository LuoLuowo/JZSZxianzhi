-- 二维码上传与资源占用后台：非破坏性升级
-- 不删除现有商品、图片、商品码、预定或管理员数据。

alter table public.site_settings add column if not exists announcement text not null default '';
alter table public.site_settings add column if not exists group_qr_url text;
insert into public.site_settings(id) values(true) on conflict(id) do nothing;

create or replace view public.public_site_settings
with (security_invoker = false)
as select id,announcement,group_qr_url,updated_at from public.site_settings where id=true;
revoke all on public.public_site_settings from public;
grant select on public.public_site_settings to anon,authenticated;
grant select,update on public.site_settings to authenticated;

create or replace function public.admin_resource_usage()
returns jsonb
language plpgsql
security definer
set search_path = public,storage,pg_temp
as $$
declare
  v_storage_count bigint := 0;
  v_storage_bytes bigint := 0;
  v_database_bytes bigint := 0;
  v_product_images bigint := 0;
  v_external_images bigint := 0;
begin
  if not public.is_admin() then raise exception '无权限'; end if;
  select count(*),coalesce(sum(case when coalesce(metadata->>'size','') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0)
  into v_storage_count,v_storage_bytes from storage.objects where bucket_id='product-images';
  select count(*) filter(where image_url is not null),count(*) filter(where image_url is not null and image_url not like '%/storage/v1/object/public/product-images/%')
  into v_product_images,v_external_images from public.products;
  v_database_bytes := pg_total_relation_size('public.profiles'::regclass)+pg_total_relation_size('public.categories'::regclass)+pg_total_relation_size('public.products'::regclass)+pg_total_relation_size('public.reservations'::regclass)+pg_total_relation_size('public.product_code_registry'::regclass)+pg_total_relation_size('public.site_settings'::regclass);
  return jsonb_build_object('storage_image_count',v_storage_count,'storage_bytes',v_storage_bytes,'database_bytes',v_database_bytes,'total_bytes',v_storage_bytes+v_database_bytes,'product_image_count',v_product_images,'external_image_count',v_external_images,'measured_at',now());
end;
$$;
revoke all on function public.admin_resource_usage() from public;
grant execute on function public.admin_resource_usage() to authenticated;
