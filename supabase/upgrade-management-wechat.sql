-- 卖方管理微信与预定返回逻辑：非破坏性升级
-- 商品中的 seller_contact 仍只供管理员查看；买家只会得到统一管理微信。

alter table public.site_settings add column if not exists admin_wechat text not null default '';
insert into public.site_settings(id,admin_wechat) values(true,'') on conflict(id) do nothing;
grant select,update on public.site_settings to authenticated;

drop function if exists public.reserve_product(uuid,text,text,text) cascade;
create function public.reserve_product(
  p_product_id uuid,
  p_buyer_name text,
  p_contact text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public,pg_temp
as $$
declare
  v_status text;
  v_quantity integer;
  v_sold_quantity integer;
  v_connection_code text;
  v_reservation_id uuid;
  v_management_wechat text;
begin
  if nullif(btrim(p_buyer_name),'') is null then raise exception '请填写姓名'; end if;
  if char_length(btrim(p_buyer_name)) > 40 then raise exception '姓名过长'; end if;
  if nullif(btrim(p_contact),'') is null then raise exception '请填写微信号'; end if;
  if char_length(btrim(p_contact)) > 120 then raise exception '微信号过长'; end if;

  select status,quantity,sold_quantity,connection_code
  into v_status,v_quantity,v_sold_quantity,v_connection_code
  from public.products where id=p_product_id for update;
  if not found then raise exception '商品不存在'; end if;
  if v_status<>'available' or v_sold_quantity>=v_quantity then raise exception '该商品已售罄或不可购买'; end if;

  insert into public.reservations(product_id,buyer_name,contact,note)
  values(p_product_id,btrim(p_buyer_name),btrim(p_contact),'')
  returning id into v_reservation_id;

  select admin_wechat into v_management_wechat from public.site_settings where id=true;
  return jsonb_build_object('reservation_id',v_reservation_id,'connection_code',v_connection_code,'seller_wechat',coalesce(v_management_wechat,''));
end;
$$;
revoke all on function public.reserve_product(uuid,text,text,text) from public;
grant execute on function public.reserve_product(uuid,text,text,text) to anon,authenticated;
