-- 投稿区图片、两分钟编辑、自动通过标识与举报反馈升级。
-- 在 Supabase Dashboard -> SQL Editor 中完整执行一次。

alter table public.campus_wall_posts
  add column if not exists approval_source text not null default 'manual';

alter table public.campus_wall_posts
  drop constraint if exists campus_wall_posts_approval_source_check;
alter table public.campus_wall_posts
  add constraint campus_wall_posts_approval_source_check
  check (approval_source in ('manual','automatic'));

-- 兼容升级前关闭审核模式时直接发布的记录。
update public.campus_wall_posts
set approval_source='automatic'
where status='approved' and reviewed_by is null and reviewed_at is not null;

create table if not exists public.campus_wall_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.campus_wall_posts(id) on delete cascade,
  reason text not null check (char_length(reason) between 2 and 500),
  client_id uuid not null,
  status text not null default 'pending' check (status in ('pending','handled')),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (post_id,client_id)
);

create index if not exists campus_wall_reports_status_created_idx
  on public.campus_wall_reports(status,created_at desc);

alter table public.admin_notifications
  drop constraint if exists admin_notifications_kind_check;
alter table public.admin_notifications
  add constraint admin_notifications_kind_check
  check (kind in ('submission','reservation','campus_wall','wall_report'));

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
declare
  v_post_id uuid;
  v_nickname text;
  v_content text;
  v_review_enabled boolean;
  v_filter_text text;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试'; end if;
  v_nickname := coalesce(nullif(btrim(p_nickname),''),'匿名');
  v_content := btrim(coalesce(p_content,''));
  if char_length(v_nickname) > 12 then raise exception '昵称最多 12 个文字'; end if;
  if char_length(v_content) < 1 or char_length(v_content) > 3000 then raise exception '内容应为 1 至 3000 个文字'; end if;

  v_filter_text := lower(regexp_replace(v_nickname || v_content,'[[:space:][:punct:]]','','g'));
  if v_filter_text ~ '(傻逼|傻b|煞笔|沙币|草泥马|操你妈|艹你妈|妈的|cnm|nmsl|去死|垃圾人|狗东西|死全家|诈骗|刷单|网赌|赌博|博彩|毒品|卖淫|色情|裸聊|高利贷|办证|代开发票|枪支|炸药|fuck|shit|bitch)' then
    raise exception '投稿内容包含不适宜发布的词汇，请修改后再提交';
  end if;

  select wall_review_enabled into v_review_enabled from public.site_settings where id=true;
  insert into public.campus_wall_posts(
    nickname,title,content,image_url,client_id,status,approval_source,reviewed_at
  ) values (
    v_nickname,left(v_content,80),v_content,nullif(btrim(p_image_url),''),p_client_id,
    case when coalesce(v_review_enabled,true) then 'pending' else 'approved' end,
    case when coalesce(v_review_enabled,true) then 'manual' else 'automatic' end,
    case when coalesce(v_review_enabled,true) then null else now() end
  ) returning id into v_post_id;
  return v_post_id;
end;
$$;
revoke all on function public.submit_campus_wall_post(text,text,text,text,uuid) from public;
grant execute on function public.submit_campus_wall_post(text,text,text,text,uuid) to anon,authenticated;

create or replace function public.update_own_campus_wall_post(
  p_post_id uuid,
  p_content text,
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_content text := btrim(coalesce(p_content,''));
  v_filter_text text;
begin
  if p_post_id is null or p_client_id is null then raise exception '投稿标识缺失'; end if;
  if char_length(v_content) < 1 or char_length(v_content) > 3000 then raise exception '内容应为 1 至 3000 个文字'; end if;
  v_filter_text := lower(regexp_replace(v_content,'[[:space:][:punct:]]','','g'));
  if v_filter_text ~ '(傻逼|傻b|煞笔|沙币|草泥马|操你妈|艹你妈|妈的|cnm|nmsl|去死|垃圾人|狗东西|死全家|诈骗|刷单|网赌|赌博|博彩|毒品|卖淫|色情|裸聊|高利贷|办证|代开发票|枪支|炸药|fuck|shit|bitch)' then
    raise exception '投稿内容包含不适宜发布的词汇，请修改后再提交';
  end if;

  update public.campus_wall_posts
  set title=left(v_content,80),content=v_content
  where id=p_post_id
    and client_id=p_client_id
    and created_at > now()-interval '2 minutes'
    and status in ('pending','approved');
  if not found then raise exception '已超过 2 分钟，无法编辑'; end if;
end;
$$;
revoke all on function public.update_own_campus_wall_post(uuid,text,uuid) from public;
grant execute on function public.update_own_campus_wall_post(uuid,text,uuid) to anon,authenticated;

create or replace function public.submit_campus_wall_report(
  p_post_id uuid,
  p_reason text,
  p_client_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report_id uuid;
  v_reason text := btrim(coalesce(p_reason,''));
  v_summary text;
begin
  if p_post_id is null or p_client_id is null then raise exception '举报标识缺失'; end if;
  if char_length(v_reason) < 2 or char_length(v_reason) > 500 then raise exception '举报问题应为 2 至 500 个文字'; end if;
  select left(content,50) into v_summary from public.campus_wall_posts where id=p_post_id and status='approved';
  if not found then raise exception '该投稿不存在或已下架'; end if;

  insert into public.campus_wall_reports(post_id,reason,client_id)
  values(p_post_id,v_reason,p_client_id)
  returning id into v_report_id;

  insert into public.admin_notifications(kind,reference_id,title,body)
  values('wall_report',v_report_id,'有新的投稿举报',v_summary);
  return v_report_id;
exception
  when unique_violation then raise exception '您已经举报过这条投稿，请等待管理员处理';
end;
$$;
revoke all on function public.submit_campus_wall_report(uuid,text,uuid) from public;
grant execute on function public.submit_campus_wall_report(uuid,text,uuid) to anon,authenticated;

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
  set status=p_action,
      approval_source='manual',
      is_pinned=case when p_action='approved' then is_pinned else false end,
      reviewed_at=now(),reviewed_by=auth.uid()
  where id=p_post_id and status='pending';
  if not found then raise exception '投稿不存在或已经审核'; end if;
end;
$$;
revoke all on function public.admin_review_campus_wall_post(uuid,text) from public;
grant execute on function public.admin_review_campus_wall_post(uuid,text) to authenticated;

alter table public.campus_wall_reports enable row level security;
drop policy if exists campus_wall_reports_admin_read on public.campus_wall_reports;
drop policy if exists campus_wall_reports_admin_update on public.campus_wall_reports;
drop policy if exists campus_wall_reports_admin_delete on public.campus_wall_reports;
create policy campus_wall_reports_admin_read on public.campus_wall_reports for select to authenticated
  using ((select public.is_admin()));
create policy campus_wall_reports_admin_update on public.campus_wall_reports for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy campus_wall_reports_admin_delete on public.campus_wall_reports for delete to authenticated
  using ((select public.is_admin()));

revoke all on public.campus_wall_reports from anon,authenticated;
grant select,update,delete on public.campus_wall_reports to authenticated;

drop view if exists public.public_campus_wall_posts;
create view public.public_campus_wall_posts
with (security_invoker = false)
as select id,nickname,title,content,image_url,is_pinned,created_at
from public.campus_wall_posts where status='approved';
grant select on public.public_campus_wall_posts to anon,authenticated;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='campus_wall_reports'
  ) then
    alter publication supabase_realtime add table public.campus_wall_reports;
  end if;
end $$;

notify pgrst,'reload schema';
