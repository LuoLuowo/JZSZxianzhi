-- 已拒绝投稿清理：仅允许管理员删除审核状态为 rejected 的记录。
-- 请在 Supabase Dashboard -> SQL Editor 中完整执行一次。

drop policy if exists product_submissions_admin_delete on public.product_submissions;
create policy product_submissions_admin_delete on public.product_submissions
for delete to authenticated
using ((select public.is_admin()) and status='rejected');
