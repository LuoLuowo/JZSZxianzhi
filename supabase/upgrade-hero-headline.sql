-- 左上角网站名称与首页主标题：非破坏性升级
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

alter table public.site_settings
  add column if not exists hero_headline text not null default '发现校园好物';

insert into public.site_settings(id) values(true) on conflict(id) do nothing;

-- 重建公开设置视图，以便前台读取新的首页主标题。
drop view if exists public.public_site_settings;
create view public.public_site_settings
with (security_invoker = false)
as
select id,announcement,hero_headline,hero_subtitle,introduction_content,introduction_image_url,updated_at
from public.site_settings
where id=true;
revoke all on public.public_site_settings from public;
grant select on public.public_site_settings to anon,authenticated;
