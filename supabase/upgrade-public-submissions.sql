-- 普通用户发布闲置并由管理员审核：非破坏性升级
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

create table if not exists public.product_submissions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  price numeric(10,2) not null check (price >= 0),
  price_type text not null default 'fixed' check (price_type in ('fixed','negotiable','at_most')),
  condition text not null check (condition in ('全新','几乎全新','轻微使用痕迹','明显使用痕迹')),
  category_id bigint not null references public.categories(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 9999),
  seller_contact text not null check (char_length(seller_contact) between 1 and 120),
  image_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists product_submissions_status_created_idx on public.product_submissions(status,created_at desc);
alter table public.product_submissions enable row level security;
revoke all on public.product_submissions from anon,authenticated;
grant insert on public.product_submissions to anon,authenticated;
grant select,update,delete on public.product_submissions to authenticated;
drop policy if exists product_submissions_public_insert on public.product_submissions;
drop policy if exists product_submissions_admin_read on public.product_submissions;
drop policy if exists product_submissions_admin_update on public.product_submissions;
drop policy if exists product_submissions_admin_delete on public.product_submissions;
create policy product_submissions_public_insert on public.product_submissions for insert to anon,authenticated
  with check (status='pending' and reviewed_at is null and reviewed_by is null);
create policy product_submissions_admin_read on public.product_submissions for select to authenticated using ((select public.is_admin()));
create policy product_submissions_admin_update on public.product_submissions for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy product_submissions_admin_delete on public.product_submissions for delete to authenticated using ((select public.is_admin()));

-- 本地上传的用户投稿图仅允许放进 submissions 目录；管理员可统一清理。
drop policy if exists product_submission_images_public_insert on storage.objects;
create policy product_submission_images_public_insert on storage.objects for insert to anon,authenticated
  with check (bucket_id='product-images' and (storage.foldername(name))[1]='submissions');

create or replace function public.admin_review_submission(p_submission_id uuid,p_action text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_submission public.product_submissions%rowtype; v_product_id uuid;
begin
  if not public.is_admin() then raise exception '无权限'; end if;
  if p_action not in ('approved','rejected') then raise exception '无效审核操作'; end if;
  select * into v_submission from public.product_submissions where id=p_submission_id for update;
  if not found then raise exception '投稿不存在'; end if;
  if v_submission.status <> 'pending' then raise exception '该投稿已审核'; end if;
  if p_action='approved' then
    insert into public.products(title,description,price,price_type,condition,campus,category_id,quantity,seller_contact,status,image_url,is_demo)
    values(v_submission.title,v_submission.description,v_submission.price,v_submission.price_type,v_submission.condition,'焦作师专校内',v_submission.category_id,v_submission.quantity,v_submission.seller_contact,'available',v_submission.image_url,false)
    returning id into v_product_id;
  end if;
  update public.product_submissions set status=p_action,reviewed_at=now(),reviewed_by=auth.uid() where id=p_submission_id;
  return v_product_id;
end;
$$;
revoke all on function public.admin_review_submission(uuid,text) from public;
grant execute on function public.admin_review_submission(uuid,text) to authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='product_submissions') then
    alter publication supabase_realtime add table public.product_submissions;
  end if;
end $$;
