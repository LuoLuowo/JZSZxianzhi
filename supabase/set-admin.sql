-- 管理员账号：sh770419@163.com
-- 先确认该邮箱已在 Supabase Dashboard -> Authentication -> Users 中创建。
-- 在 SQL Editor 中直接执行本文件全部内容。
-- 本脚本会补齐 profiles 资料并设置 is_admin，避免“无权限”登录失败。

insert into public.profiles(id,nickname,is_admin)
select id,split_part(coalesce(email,'管理员'),'@',1),true
from auth.users
where lower(email) = 'sh770419@163.com'
on conflict(id) do update set is_admin=true;

-- 验证结果：应返回一行且 is_admin 为 true。
select p.id, u.email, p.nickname, p.is_admin
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = 'sh770419@163.com';
