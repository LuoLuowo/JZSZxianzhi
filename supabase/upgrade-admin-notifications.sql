-- 管理员实时通知：新发布审核和新想要记录均写入通知中心。
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('submission','reservation')),
  reference_id uuid not null,
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists admin_notifications_unread_idx on public.admin_notifications(is_read,created_at desc);
alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from anon,authenticated;
grant select,update,delete on public.admin_notifications to authenticated;
drop policy if exists admin_notifications_admin_read on public.admin_notifications;
drop policy if exists admin_notifications_admin_update on public.admin_notifications;
drop policy if exists admin_notifications_admin_delete on public.admin_notifications;
create policy admin_notifications_admin_read on public.admin_notifications for select to authenticated
  using ((select public.is_admin()));
create policy admin_notifications_admin_update on public.admin_notifications for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_notifications_admin_delete on public.admin_notifications for delete to authenticated
  using ((select public.is_admin()));

create or replace function public.create_submission_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.admin_notifications(kind,reference_id,title,body)
  values ('submission',new.id,'有新的闲置待审核',new.title);
  return new;
end;
$$;

create or replace function public.create_reservation_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_title text;
begin
  select title into v_title from public.products where id=new.product_id;
  insert into public.admin_notifications(kind,reference_id,title,body)
  values ('reservation',new.id,'有新的想要记录',coalesce(v_title,'商品已删除') || ' · ' || new.buyer_name);
  return new;
end;
$$;

drop trigger if exists product_submissions_create_notification on public.product_submissions;
create trigger product_submissions_create_notification
after insert on public.product_submissions
for each row execute function public.create_submission_notification();

drop trigger if exists reservations_create_notification on public.reservations;
create trigger reservations_create_notification
after insert on public.reservations
for each row execute function public.create_reservation_notification();

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='admin_notifications') then
    alter publication supabase_realtime add table public.admin_notifications;
  end if;
end $$;
