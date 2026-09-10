-- 网站介绍、首页副标题与商品置顶：非破坏性升级
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。
-- 不会删除现有商品、对接码、预定记录、管理员或图片。

alter table public.site_settings
  add column if not exists hero_subtitle text not null default '校内二手闲置交换，教材、数码、生活好物，轻松找到下一位主人。',
  add column if not exists introduction_content text not null default '',
  add column if not exists introduction_image_url text;

alter table public.products
  add column if not exists is_pinned boolean not null default false;

create index if not exists products_pinned_created_idx
  on public.products(is_pinned desc, created_at desc);

insert into public.site_settings(id) values(true) on conflict(id) do nothing;

-- 现有公开视图需要替换字段，因此先删除后立刻重建；不影响任何表数据。
drop view if exists public.product_feed;
drop view if exists public.public_site_settings;

-- 只把可公开的前台内容提供给匿名访客；管理员微信仍不会暴露。
create or replace view public.public_site_settings
with (security_invoker = false)
as
select id,announcement,hero_subtitle,introduction_content,introduction_image_url,updated_at
from public.site_settings
where id=true;

-- 前台商品视图：隐藏卖家微信，增加置顶标记。
create or replace view public.product_feed
with (security_invoker = false)
as
select
  p.id,p.title,p.description,p.price,p.condition,p.campus,p.category_id,p.status,
  p.image_url,p.is_demo,p.quantity,p.sold_quantity,p.is_pinned,
  greatest(p.quantity-p.sold_quantity,0) as available_quantity,
  count(r.id) filter (where r.status in ('pending','confirmed'))::integer as wanted_count,
  p.created_at,
  c.name as category_name,c.icon as category_icon
from public.products p
join public.categories c on c.id=p.category_id
left join public.reservations r on r.product_id=p.id
where p.status <> 'removed'
group by p.id,c.id;

revoke all on public.public_site_settings,public.product_feed from public;
grant select on public.public_site_settings,public.product_feed to anon,authenticated;
