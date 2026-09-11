-- 交换微信直连 + 校园墙升级
-- 可重复执行。请在 Supabase Dashboard -> SQL Editor 中完整运行本文件。

create extension if not exists pgcrypto;

-- 1. 商品公开视图增加五位商品码，详情页可以直接展示。
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
  p.is_recommended,
  p.connection_code
from public.products p
join public.categories c on c.id=p.category_id
left join public.reservations r on r.product_id=p.id
where p.status <> 'removed'
group by p.id,c.id;

grant select on public.product_feed to anon,authenticated;

-- 2. 用户登记后直接返回该商品的交换微信，不再返回商品码或平台管理微信。
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
  v_exchange_wechat text;
  v_window_started_at timestamptz;
  v_submit_count smallint;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试'; end if;
  if nullif(btrim(p_buyer_name),'') is null then raise exception '请填写称呼'; end if;
  if char_length(btrim(p_buyer_name)) > 6 then raise exception '称呼最多输入 6 个文字'; end if;
  if nullif(btrim(p_contact),'') is null then raise exception '请填写您的交换微信'; end if;
  if char_length(btrim(p_contact)) > 120 then raise exception '交换微信过长'; end if;
  if btrim(p_contact) !~ '^[A-Za-z0-9._-]+$' then raise exception '交换微信仅支持英文字母、数字和 . _ - 符号'; end if;

  select status,quantity,sold_quantity,seller_contact
  into v_status,v_quantity,v_sold_quantity,v_exchange_wechat
  from public.products where id=p_product_id for update;
  if not found then raise exception '商品不存在'; end if;
  if v_status <> 'available' or v_sold_quantity >= v_quantity then raise exception '该商品已售罄或不可购买'; end if;
  if nullif(btrim(coalesce(v_exchange_wechat,'')),'') is null then raise exception '该商品暂未填写交换微信，请稍后再试'; end if;

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
  values(p_product_id,btrim(p_buyer_name),btrim(p_contact),'')
  returning id into v_reservation_id;

  return jsonb_build_object(
    'reservation_id',v_reservation_id,
    'exchange_wechat',coalesce(v_exchange_wechat,'')
  );
end;
$$;

revoke all on function public.reserve_product(uuid,text,text,text,uuid) from public;
grant execute on function public.reserve_product(uuid,text,text,text,uuid) to anon,authenticated;

-- 同步商品发布时的交换微信校验文案。
create or replace function public.validate_seller_contact()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.seller_contact is null or btrim(new.seller_contact)='' then new.seller_contact:=null;return new;end if;
  new.seller_contact:=btrim(new.seller_contact);
  if new.seller_contact !~ '^[A-Za-z0-9._-]+$' then raise exception '交换微信仅支持英文字母、数字和 . _ - 符号';end if;
  return new;
end;
$$;

create or replace function public.submit_product_submission(
  p_title text,p_description text,p_price numeric,p_price_type text,p_condition text,
  p_category_id bigint,p_quantity integer,p_seller_contact text,p_image_url text default null,p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_submission_id uuid;v_window_started_at timestamptz;v_submit_count smallint;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试';end if;
  if nullif(btrim(p_title),'') is null or char_length(btrim(p_title))>120 then raise exception '商品标题应为 1 至 120 个字符';end if;
  if char_length(coalesce(p_description,''))>3000 then raise exception '详细描述不能超过 3000 个字符';end if;
  if p_price is null or p_price<0 then raise exception '请输入正确的价格';end if;
  if p_price_type not in ('fixed','negotiable','at_most') then raise exception '无效价格方式';end if;
  if p_condition not in ('全新','几乎全新','轻微使用痕迹','明显使用痕迹') then raise exception '请选择商品成色';end if;
  if p_quantity is null or p_quantity not between 1 and 9999 then raise exception '商品数量应在 1 至 9999 之间';end if;
  if nullif(btrim(p_seller_contact),'') is null or char_length(btrim(p_seller_contact))>120 then raise exception '请填写交换微信';end if;
  if btrim(p_seller_contact) !~ '^[A-Za-z0-9._-]+$' then raise exception '交换微信仅支持英文字母、数字和 . _ - 符号';end if;
  insert into public.submission_rate_limits(client_id) values(p_client_id) on conflict(client_id) do nothing;
  select window_started_at,submit_count into v_window_started_at,v_submit_count from public.submission_rate_limits where client_id=p_client_id for update;
  if v_window_started_at<=now()-interval '1 minute' then
    update public.submission_rate_limits set window_started_at=now(),submit_count=1,updated_at=now() where client_id=p_client_id;
  elsif v_submit_count>=2 then raise exception '提交过于频繁：同一浏览器 1 分钟内最多发布 2 次闲置，请稍后再试';
  else update public.submission_rate_limits set submit_count=submit_count+1,updated_at=now() where client_id=p_client_id;
  end if;
  insert into public.product_submissions(title,description,price,price_type,condition,category_id,quantity,seller_contact,image_url,status)
  values(btrim(p_title),coalesce(p_description,''),p_price,p_price_type,p_condition,p_category_id,p_quantity,btrim(p_seller_contact),nullif(btrim(p_image_url),''),'pending')
  returning id into v_submission_id;
  return v_submission_id;
end;
$$;
revoke all on function public.submit_product_submission(text,text,numeric,text,text,bigint,integer,text,text,uuid) from public;
grant execute on function public.submit_product_submission(text,text,numeric,text,text,bigint,integer,text,text,uuid) to anon,authenticated;

-- 3. 校园墙投稿、审核与公开展示。
create table if not exists public.campus_wall_posts (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 12),
  title text not null check (char_length(title) between 1 and 80),
  content text not null check (char_length(content) between 1 and 3000),
  image_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_pinned boolean not null default false,
  client_id uuid not null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists campus_wall_posts_status_created_idx on public.campus_wall_posts(status,is_pinned desc,created_at desc);

alter table public.campus_wall_posts enable row level security;
drop policy if exists campus_wall_posts_admin_read on public.campus_wall_posts;
drop policy if exists campus_wall_posts_admin_update on public.campus_wall_posts;
drop policy if exists campus_wall_posts_admin_delete on public.campus_wall_posts;
create policy campus_wall_posts_admin_read on public.campus_wall_posts for select to authenticated
  using ((select public.is_admin()));
create policy campus_wall_posts_admin_update on public.campus_wall_posts for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy campus_wall_posts_admin_delete on public.campus_wall_posts for delete to authenticated
  using ((select public.is_admin()));

create or replace view public.public_campus_wall_posts
with (security_invoker = false)
as select id,nickname,title,content,image_url,is_pinned,created_at
from public.campus_wall_posts
where status='approved';

revoke all on public.campus_wall_posts from anon,authenticated;
grant select,update,delete on public.campus_wall_posts to authenticated;
grant select on public.public_campus_wall_posts to anon,authenticated;

create or replace function public.submit_campus_wall_post(
  p_nickname text,
  p_title text,
  p_content text,
  p_image_url text default null,
  p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_post_id uuid;
declare v_nickname text;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试'; end if;
  v_nickname := coalesce(nullif(btrim(p_nickname),''),'匿名');
  if char_length(v_nickname) > 12 then raise exception '昵称最多 12 个文字'; end if;
  if nullif(btrim(p_title),'') is null or char_length(btrim(p_title)) > 80 then raise exception '标题应为 1 至 80 个文字'; end if;
  if nullif(btrim(p_content),'') is null or char_length(btrim(p_content)) > 3000 then raise exception '内容应为 1 至 3000 个文字'; end if;
  insert into public.campus_wall_posts(nickname,title,content,image_url,client_id)
  values(v_nickname,btrim(p_title),btrim(p_content),nullif(btrim(p_image_url),''),p_client_id)
  returning id into v_post_id;
  return v_post_id;
end;
$$;

revoke all on function public.submit_campus_wall_post(text,text,text,text,uuid) from public;
grant execute on function public.submit_campus_wall_post(text,text,text,text,uuid) to anon,authenticated;

create or replace function public.admin_review_campus_wall_post(p_post_id uuid,p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception '无权限'; end if;
  if p_action not in ('approved','rejected') then raise exception '无效审核操作'; end if;
  update public.campus_wall_posts
  set status=p_action,is_pinned=case when p_action='approved' then is_pinned else false end,
      reviewed_at=now(),reviewed_by=auth.uid()
  where id=p_post_id and status='pending';
  if not found then raise exception '投稿不存在或已经审核'; end if;
end;
$$;

revoke all on function public.admin_review_campus_wall_post(uuid,text) from public;
grant execute on function public.admin_review_campus_wall_post(uuid,text) to authenticated;

-- 校园墙投稿也进入后台未读通知。
alter table public.admin_notifications drop constraint if exists admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check
  check (kind in ('submission','reservation','campus_wall'));

create or replace function public.create_campus_wall_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.admin_notifications(kind,reference_id,title,body)
  values('campus_wall',new.id,'有新的校园墙投稿',new.nickname || ' · ' || new.title);
  return new;
end;
$$;

drop trigger if exists campus_wall_posts_create_notification on public.campus_wall_posts;
create trigger campus_wall_posts_create_notification after insert on public.campus_wall_posts
for each row execute function public.create_campus_wall_notification();

-- 匿名投稿图片只允许写入指定目录；读取仍沿用公开图片策略。
drop policy if exists product_submission_images_public_insert on storage.objects;
create policy product_submission_images_public_insert on storage.objects for insert to anon,authenticated
  with check (bucket_id='product-images' and (storage.foldername(name))[1] in ('submissions','wall-submissions'));

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='campus_wall_posts'
  ) then
    alter publication supabase_realtime add table public.campus_wall_posts;
  end if;
end $$;

-- 资源统计纳入校园墙照片和数据表。
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
  into v_product_images,v_external_images
  from (select image_url from public.products union all select image_url from public.product_submissions union all select image_url from public.campus_wall_posts) images;
  v_database_bytes := pg_total_relation_size('public.profiles'::regclass)+pg_total_relation_size('public.categories'::regclass)+pg_total_relation_size('public.hot_searches'::regclass)+pg_total_relation_size('public.products'::regclass)+pg_total_relation_size('public.product_submissions'::regclass)+pg_total_relation_size('public.submission_rate_limits'::regclass)+pg_total_relation_size('public.admin_notifications'::regclass)+pg_total_relation_size('public.site_visitors'::regclass)+pg_total_relation_size('public.reservations'::regclass)+pg_total_relation_size('public.product_code_registry'::regclass)+pg_total_relation_size('public.site_settings'::regclass)+pg_total_relation_size('public.campus_wall_posts'::regclass);
  return jsonb_build_object('storage_image_count',v_storage_count,'storage_bytes',v_storage_bytes,'database_bytes',v_database_bytes,'total_bytes',v_storage_bytes+v_database_bytes,'product_image_count',v_product_images,'external_image_count',v_external_images,'measured_at',now());
end;
$$;
revoke all on function public.admin_resource_usage() from public;
grant execute on function public.admin_resource_usage() to authenticated;

-- 刷新 API 架构缓存。
notify pgrst,'reload schema';
