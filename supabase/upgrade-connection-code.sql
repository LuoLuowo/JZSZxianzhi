-- 焦大师专闲置好物平台：非破坏性升级脚本
-- 已执行过旧版 supabase.sql 时，只执行本文件；不会删除商品、分类或想要记录。

create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  admin_wechat text not null default '',
  announcement text not null default '',
  group_qr_url text,
  updated_at timestamptz not null default now()
);
insert into public.site_settings(id,admin_wechat) values(true,'') on conflict (id) do nothing;
alter table public.site_settings add column if not exists announcement text not null default '';
alter table public.site_settings add column if not exists group_qr_url text;

create or replace view public.public_site_settings
with (security_invoker = false)
as select id,announcement,group_qr_url,updated_at from public.site_settings where id=true;
revoke all on public.public_site_settings from public;
grant select on public.public_site_settings to anon,authenticated;

alter table public.products add column if not exists connection_code text;

-- 永久编码台账没有商品外键，商品删除后对接码仍会永久占用。
create table if not exists public.product_code_registry (
  code text primary key check (code ~ '^[0-9]{5}$'),
  product_id uuid not null unique,
  product_title text not null,
  issued_at timestamptz not null default now()
);

insert into public.product_code_registry(code,product_id,product_title,issued_at)
select connection_code,id,title,created_at from public.products where connection_code is not null
on conflict do nothing;

alter table public.products alter column connection_code drop default;
drop function if exists public.generate_connection_code() cascade;

create or replace function public.issue_product_code(p_product_id uuid,p_product_title text)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare v_code text; v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 1000 then raise exception '五位商品码已接近用尽，无法生成新编码'; end if;
    v_code := lpad((floor(random() * 100000)::integer)::text, 5, '0');
    begin
      insert into public.product_code_registry(code,product_id,product_title)
      values(v_code,p_product_id,p_product_title);
      return v_code;
    exception when unique_violation then
    end;
  end loop;
end;
$$;

update public.products set connection_code = public.issue_product_code(id,title) where connection_code is null;
alter table public.products alter column connection_code set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_connection_code_key') then
    alter table public.products add constraint products_connection_code_key unique (connection_code);
  end if;
  if not exists (select 1 from pg_constraint where conname='products_connection_code_digits_check') then
    alter table public.products add constraint products_connection_code_digits_check check (connection_code ~ '^[0-9]{5}$');
  end if;
end $$;

create or replace function public.assign_product_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.connection_code := public.issue_product_code(new.id,new.title);
  else
    new.connection_code := old.connection_code;
    update public.product_code_registry set product_title=new.title where product_id=new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists products_assign_code on public.products;
create trigger products_assign_code before insert or update on public.products
for each row execute function public.assign_product_code();
revoke all on function public.issue_product_code(uuid,text) from public;
revoke all on function public.assign_product_code() from public;

-- 预定接口仅在买家成功提交想要后，返回对接码和该商品卖方微信。
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
set search_path = public, pg_temp
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
  if nullif(btrim(p_contact),'') is null then raise exception '请填写联系方式'; end if;
  if char_length(btrim(p_contact)) > 120 then raise exception '联系方式过长'; end if;
  if char_length(coalesce(p_note,'')) > 1000 then raise exception '备注过长'; end if;

  select status,quantity,sold_quantity,connection_code
  into v_status,v_quantity,v_sold_quantity,v_connection_code
  from public.products where id = p_product_id for update;
  if not found then raise exception '商品不存在'; end if;
  if v_status <> 'available' or v_sold_quantity >= v_quantity then raise exception '该商品已售罄或不可购买'; end if;

  insert into public.reservations(product_id,buyer_name,contact,note)
  values (p_product_id,btrim(p_buyer_name),btrim(p_contact),coalesce(btrim(p_note),''))
  returning id into v_reservation_id;

  select admin_wechat into v_management_wechat from public.site_settings where id=true;
  return jsonb_build_object('reservation_id',v_reservation_id,'connection_code',v_connection_code,'seller_wechat',coalesce(v_management_wechat,''));
end;
$$;
revoke all on function public.reserve_product(uuid,text,text,text) from public;
grant execute on function public.reserve_product(uuid,text,text,text) to anon,authenticated;

alter table public.site_settings enable row level security;
drop policy if exists site_settings_admin_read on public.site_settings;
drop policy if exists site_settings_admin_update on public.site_settings;
create policy site_settings_admin_read on public.site_settings for select to authenticated using ((select public.is_admin()));
create policy site_settings_admin_update on public.site_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.site_settings from anon,authenticated;
grant select,update on public.site_settings to authenticated;

alter table public.product_code_registry enable row level security;
drop policy if exists product_code_registry_admin_read on public.product_code_registry;
create policy product_code_registry_admin_read on public.product_code_registry for select to authenticated using ((select public.is_admin()));
revoke all on public.product_code_registry from anon,authenticated;
grant select on public.product_code_registry to authenticated;

create or replace function public.admin_grant_admin(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public,auth,pg_temp
as $$
declare v_user_id uuid; v_nickname text;
begin
  if not public.is_admin() then raise exception '无权限'; end if;
  select id into v_user_id from auth.users where lower(email)=lower(btrim(p_email));
  if v_user_id is null then raise exception '该邮箱尚未在 Authentication Users 中创建账号'; end if;
  insert into public.profiles(id,nickname,is_admin)
  select id,split_part(coalesce(email,'管理员'),'@',1),true from auth.users where id=v_user_id
  on conflict(id) do update set is_admin=true;
  select nickname into v_nickname from public.profiles where id=v_user_id;
  return jsonb_build_object('id',v_user_id,'email',lower(btrim(p_email)),'nickname',v_nickname);
end;
$$;
revoke all on function public.admin_grant_admin(text) from public;
grant execute on function public.admin_grant_admin(text) to authenticated;

create or replace function public.admin_list_admins()
returns table(id uuid,email text,nickname text,created_at timestamptz)
language plpgsql
security definer
set search_path = public,auth,pg_temp
as $$
begin
  if not public.is_admin() then raise exception '无权限'; end if;
  return query select p.id,u.email::text,p.nickname,p.created_at
  from public.profiles p join auth.users u on u.id=p.id
  where p.is_admin=true order by p.created_at;
end;
$$;
revoke all on function public.admin_list_admins() from public;
grant execute on function public.admin_list_admins() to authenticated;
