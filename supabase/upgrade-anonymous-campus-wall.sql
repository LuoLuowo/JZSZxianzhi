-- 校园墙匿名投稿升级：在 Supabase SQL Editor 执行一次即可。
alter table public.campus_wall_posts
  alter column nickname set default '匿名';

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
