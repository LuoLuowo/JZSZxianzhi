-- 首页公告与好物群：非破坏性升级
-- 不删除任何商品、商品码、预定或管理员数据。

alter table public.site_settings add column if not exists announcement text not null default '';
alter table public.site_settings add column if not exists group_qr_url text;
insert into public.site_settings(id) values(true) on conflict(id) do nothing;

create or replace view public.public_site_settings
with (security_invoker = false)
as
select id,announcement,group_qr_url,updated_at
from public.site_settings
where id=true;

revoke all on public.public_site_settings from public;
grant select on public.public_site_settings to anon,authenticated;
grant select,update on public.site_settings to authenticated;
