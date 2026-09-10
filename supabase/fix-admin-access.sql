-- 管理员登录“无权限”修复脚本
-- 在 Supabase Dashboard -> SQL Editor 执行全部内容。
-- 前提：Authentication -> Users 已存在 sh770419@163.com。

alter table public.profiles add column if not exists is_admin boolean not null default false;

insert into public.profiles(id,nickname,is_admin)
select id,split_part(coalesce(email,'管理员'),'@',1),true
from auth.users
where lower(email) = 'sh770419@163.com'
on conflict(id) do update set is_admin=true;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()),false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon,authenticated;

alter table public.profiles enable row level security;
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
grant select on public.profiles to authenticated;

-- 必须返回一行且 is_admin 为 true。
select p.id,u.email,p.nickname,p.is_admin
from public.profiles p
join auth.users u on u.id=p.id
where lower(u.email) = 'sh770419@163.com';
