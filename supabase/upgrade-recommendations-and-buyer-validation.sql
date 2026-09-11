-- 推荐闲置与买家输入校验：非破坏性升级
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

alter table public.products add column if not exists is_recommended boolean not null default false;
create index if not exists products_recommended_created_idx on public.products(is_recommended desc,created_at desc);

create or replace view public.product_feed
with (security_invoker = false)
as
select
  p.id,p.title,p.description,p.price,p.price_type,p.condition,p.campus,p.category_id,p.status,
  p.image_url,p.is_demo,p.quantity,p.sold_quantity,p.is_pinned,
  greatest(p.quantity-p.sold_quantity,0) as available_quantity,
  count(r.id) filter (where r.status in ('pending','confirmed'))::integer as wanted_count,
  p.created_at,
  c.name as category_name,c.icon as category_icon,
  p.is_recommended
from public.products p
join public.categories c on c.id=p.category_id
left join public.reservations r on r.product_id=p.id
where p.status <> 'removed'
group by p.id,c.id;
grant select on public.product_feed to anon,authenticated;

create or replace function public.reserve_product(
  p_product_id uuid,
  p_buyer_name text,
  p_contact text,
  p_note text default '',
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_quantity integer;
  v_sold_quantity integer;
  v_reservation_id uuid;
  v_connection_code text;
  v_management_wechat text;
  v_window_started_at timestamptz;
  v_submit_count smallint;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试'; end if;
  if nullif(btrim(p_buyer_name),'') is null then raise exception '请填写称呼'; end if;
  if char_length(btrim(p_buyer_name)) > 6 then raise exception '称呼最多输入 6 个文字'; end if;
  if nullif(btrim(p_contact),'') is null then raise exception '请填写您的微信号'; end if;
  if char_length(btrim(p_contact)) > 120 then raise exception '微信号过长'; end if;
  if btrim(p_contact) !~ '^[A-Za-z0-9._-]+$' then raise exception '微信号仅支持英文字母、数字和 . _ - 符号'; end if;
  if char_length(coalesce(p_note,'')) > 1000 then raise exception '备注过长'; end if;

  select status,quantity,sold_quantity,connection_code into v_status,v_quantity,v_sold_quantity,v_connection_code
  from public.products where id=p_product_id for update;
  if not found then raise exception '商品不存在'; end if;
  if v_status <> 'available' or v_sold_quantity >= v_quantity then raise exception '该商品已售罄或不可购买'; end if;

  insert into public.reservation_rate_limits(client_id) values(p_client_id) on conflict(client_id) do nothing;
  select window_started_at,submit_count into v_window_started_at,v_submit_count
  from public.reservation_rate_limits where client_id=p_client_id for update;
  if v_window_started_at <= now()-interval '5 minutes' then
    update public.reservation_rate_limits set window_started_at=now(),submit_count=1,updated_at=now() where client_id=p_client_id;
  elsif v_submit_count >= 3 then
    raise exception '提交过于频繁：同一浏览器 5 分钟内最多提交 3 次想要，请稍后再试';
  else
    update public.reservation_rate_limits set submit_count=submit_count+1,updated_at=now() where client_id=p_client_id;
  end if;

  insert into public.reservations(product_id,buyer_name,contact,note)
  values(p_product_id,btrim(p_buyer_name),btrim(p_contact),coalesce(btrim(p_note),''))
  returning id into v_reservation_id;

  select admin_wechat into v_management_wechat from public.site_settings where id=true;
  return jsonb_build_object('reservation_id',v_reservation_id,'connection_code',v_connection_code,'seller_wechat',coalesce(v_management_wechat,''));
end;
$$;

revoke all on function public.reserve_product(uuid,text,text,text,uuid) from public;
grant execute on function public.reserve_product(uuid,text,text,text,uuid) to anon,authenticated;
