-- 卖家微信格式限制：仅允许英文字母、数字和 . _ - 。
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

create or replace function public.validate_seller_contact()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.seller_contact is null or btrim(new.seller_contact) = '' then
    new.seller_contact := null;
    return new;
  end if;
  new.seller_contact := btrim(new.seller_contact);
  if new.seller_contact !~ '^[A-Za-z0-9._-]+$' then
    raise exception '卖家微信仅支持英文字母、数字和 . _ - 符号';
  end if;
  return new;
end;
$$;

drop trigger if exists products_validate_seller_contact on public.products;
create trigger products_validate_seller_contact
before insert or update of seller_contact on public.products
for each row execute function public.validate_seller_contact();

create or replace function public.submit_product_submission(
  p_title text,
  p_description text,
  p_price numeric,
  p_price_type text,
  p_condition text,
  p_category_id bigint,
  p_quantity integer,
  p_seller_contact text,
  p_image_url text default null,
  p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission_id uuid;
  v_window_started_at timestamptz;
  v_submit_count smallint;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试'; end if;
  if nullif(btrim(p_title),'') is null or char_length(btrim(p_title)) > 120 then raise exception '商品标题应为 1 至 120 个字符'; end if;
  if char_length(coalesce(p_description,'')) > 3000 then raise exception '详细描述不能超过 3000 个字符'; end if;
  if p_price is null or p_price < 0 then raise exception '请输入正确的价格'; end if;
  if p_price_type not in ('fixed','negotiable','at_most') then raise exception '无效价格方式'; end if;
  if p_condition not in ('全新','几乎全新','轻微使用痕迹','明显使用痕迹') then raise exception '请选择商品成色'; end if;
  if p_quantity is null or p_quantity not between 1 and 9999 then raise exception '商品数量应在 1 至 9999 之间'; end if;
  if nullif(btrim(p_seller_contact),'') is null or char_length(btrim(p_seller_contact)) > 120 then raise exception '请填写卖家微信'; end if;
  if btrim(p_seller_contact) !~ '^[A-Za-z0-9._-]+$' then raise exception '卖家微信仅支持英文字母、数字和 . _ - 符号'; end if;

  insert into public.submission_rate_limits(client_id) values(p_client_id)
  on conflict(client_id) do nothing;
  select window_started_at,submit_count into v_window_started_at,v_submit_count
  from public.submission_rate_limits where client_id=p_client_id for update;
  if v_window_started_at <= now()-interval '1 minute' then
    update public.submission_rate_limits set window_started_at=now(),submit_count=1,updated_at=now() where client_id=p_client_id;
  elsif v_submit_count >= 2 then
    raise exception '提交过于频繁：同一浏览器 1 分钟内最多发布 2 次闲置，请稍后再试';
  else
    update public.submission_rate_limits set submit_count=submit_count+1,updated_at=now() where client_id=p_client_id;
  end if;

  insert into public.product_submissions(title,description,price,price_type,condition,category_id,quantity,seller_contact,image_url,status)
  values(btrim(p_title),coalesce(p_description,''),p_price,p_price_type,p_condition,p_category_id,p_quantity,btrim(p_seller_contact),nullif(btrim(p_image_url),''),'pending')
  returning id into v_submission_id;
  return v_submission_id;
end;
$$;

revoke all on function public.submit_product_submission(text,text,numeric,text,text,bigint,integer,text,text,uuid) from public;
grant execute on function public.submit_product_submission(text,text,numeric,text,text,bigint,integer,text,text,uuid) to anon,authenticated;
