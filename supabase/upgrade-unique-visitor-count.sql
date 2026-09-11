-- 累计访问人数：同一浏览器只统计一次，并仅向管理员开放总数
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

-- client_id 由浏览器首次打开网站时生成并保存在 localStorage。
-- 主键去重保证同一浏览器无论刷新多少次都只计为一次访问。
create table if not exists public.site_visitors (
  client_id uuid primary key,
  first_seen_at timestamptz not null default now()
);

create index if not exists site_visitors_first_seen_idx
  on public.site_visitors(first_seen_at desc);

alter table public.site_visitors enable row level security;

drop policy if exists site_visitors_admin_read on public.site_visitors;
create policy site_visitors_admin_read on public.site_visitors for select to authenticated
  using ((select public.is_admin()));

revoke all on public.site_visitors from anon,authenticated;
grant select on public.site_visitors to authenticated;

-- 前台只能登记自己的浏览器标识，函数不返回访客数据。
create or replace function public.track_site_visitor(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_client_id is null then
    raise exception '浏览器标识缺失';
  end if;

  insert into public.site_visitors(client_id)
  values(p_client_id)
  on conflict (client_id) do nothing;
end;
$$;

revoke all on function public.track_site_visitor(uuid) from public;
grant execute on function public.track_site_visitor(uuid) to anon,authenticated;

-- 总数只可由管理员后台读取。
create or replace function public.admin_visitor_count()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '无权限';
  end if;
  return (select count(*) from public.site_visitors);
end;
$$;

revoke all on function public.admin_visitor_count() from public;
grant execute on function public.admin_visitor_count() to authenticated;

-- 新访客写入后让已打开的管理员后台即时刷新累计访问人数。
do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='site_visitors'
  ) then
    alter publication supabase_realtime add table public.site_visitors;
  end if;
end $$;
