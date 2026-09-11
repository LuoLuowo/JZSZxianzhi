-- 投稿区审核模式与违禁词拦截升级：在 Supabase SQL Editor 执行一次。
alter table public.site_settings
  add column if not exists wall_review_enabled boolean not null default true;

create or replace function public.get_wall_review_enabled()
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$ select coalesce((select wall_review_enabled from public.site_settings where id=true),true); $$;
revoke all on function public.get_wall_review_enabled() from public;
grant execute on function public.get_wall_review_enabled() to anon,authenticated;

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
  v_review_enabled boolean;
  v_filter_text text;
begin
  if p_client_id is null then raise exception '浏览器标识缺失，请刷新页面后重试'; end if;
  v_nickname := coalesce(nullif(btrim(p_nickname),''),'匿名');
  if char_length(v_nickname) > 12 then raise exception '昵称最多 12 个文字'; end if;
  if nullif(btrim(p_title),'') is null or char_length(btrim(p_title)) > 80 then raise exception '标题应为 1 至 80 个文字'; end if;
  if nullif(btrim(p_content),'') is null or char_length(btrim(p_content)) > 3000 then raise exception '内容应为 1 至 3000 个文字'; end if;

  v_filter_text := lower(regexp_replace(coalesce(p_title,'') || coalesce(p_content,''),'[[:space:][:punct:]]','','g'));
  if v_filter_text ~ '(傻逼|傻b|煞笔|沙币|草泥马|操你妈|艹你妈|妈的|cnm|nmsl|去死|垃圾人|狗东西|死全家|诈骗|刷单|网赌|赌博|博彩|毒品|卖淫|色情|裸聊|高利贷|办证|代开发票|枪支|炸药|fuck|shit|bitch)' then
    raise exception '投稿内容包含不适宜发布的词汇，请修改后再提交';
  end if;

  select wall_review_enabled into v_review_enabled from public.site_settings where id=true;
  insert into public.campus_wall_posts(nickname,title,content,image_url,client_id,status,reviewed_at)
  values(v_nickname,btrim(p_title),btrim(p_content),nullif(btrim(p_image_url),''),p_client_id,
    case when coalesce(v_review_enabled,true) then 'pending' else 'approved' end,
    case when coalesce(v_review_enabled,true) then null else now() end)
  returning id into v_post_id;
  return v_post_id;
end;
$$;

create or replace function public.create_campus_wall_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'pending' then return new; end if;
  insert into public.admin_notifications(kind,reference_id,title,body)
  values('campus_wall',new.id,'有新的投稿区内容',new.nickname || ' · ' || new.title);
  return new;
end;
$$;
