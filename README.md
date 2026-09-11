# 焦大师专闲置好物平台

原生 HTML、CSS、JavaScript + Supabase 单页项目。普通访客无需注册或登录即可浏览、搜索和预定；只有管理员需要登录后台。

## 目录

```text
焦大师专闲置好物平台/
├─ index.html                 前台页面
├─ admin.html                 独立管理员后台
├─ assets/
│  ├─ css/style.css          青柠校园双主题样式
│  ├─ css/admin.css          独立后台样式
│  ├─ js/app.js              前台与预定逻辑
│  └─ js/admin.js            后台统计、查询和管理逻辑
├─ supabase/
│  ├─ set-admin.sql          设置首位管理员脚本
│  ├─ upgrade-connection-code.sql  保留数据的商品码升级脚本
│  ├─ upgrade-announcement.sql     首页公告与好物群升级脚本
│  ├─ upgrade-resource-dashboard.sql  二维码上传与资源统计升级脚本
│  └─ upgrade-management-wechat.sql  统一管理微信升级脚本
│  └─ upgrade-site-introduction-and-pinning.sql  网站介绍、副标题与商品置顶升级脚本
│  └─ upgrade-online-rate-limit-and-pricing.sql  在线人数、预定限流与价格方式升级脚本
├─ supabase.sql              数据库全量重建脚本
└─ README.md                 本说明
```

## 一、重建数据库

`supabase.sql` 是全量重建脚本，会删除旧的 profiles、categories、products、reservations 表及旧数据，然后重新创建并写入 10 件演示商品。

如果此前已经执行过旧版脚本并保留了真实数据，请改为执行 `supabase/upgrade-connection-code.sql`，它会补齐永久对接码并更新预定接口，不会删除既有数据。

1. 登录 Supabase Dashboard。
2. 打开项目的 **SQL Editor**。
3. 复制 `supabase.sql` 全部内容并点击 **Run**。
4. 运行成功后刷新网页，即可看到 8 个默认分类和 10 件演示商品。

演示商品的 `is_demo` 为 `true`，管理员可在商品管理中逐个删除。

## 二、设置管理员

1. 打开 Supabase **Authentication → Users**。
2. 点击 **Add user / Create new user**，创建管理员邮箱和密码，建议勾选自动确认邮箱。
3. 在 SQL Editor 打开并执行 `supabase/set-admin.sql`。文件已预填 `sh770419@163.com`。
4. 查看脚本最后的查询结果：该邮箱必须返回一行，且 `is_admin` 为 `true`。
5. 回到网页，点击右上角盾牌，使用该邮箱和密码登录。

若管理员登录提示“无权限执行此操作”，执行 `supabase/fix-admin-access.sql`，确认最后一条查询中 `is_admin` 为 `true` 后，刷新页面再登录。

商品图片可选择本地文件，也可填写任意 HTTP/HTTPS 图片直链。本地文件会压缩为约 120KB 以内、最大边 1280 像素的 WebP 后上传；URL 会直接保存并通过图片标签显示，不下载或转换。

首页支持标题/描述搜索、分类与价格区间组合筛选、价格升降序排列，并按当前屏幕列数每页最多显示六行。近期热搜由 `hot_searches` 表提供，管理员可在独立后台的“热搜管理”中增删、排序和启用停用。现有数据库升级请执行 `supabase/upgrade-hot-searches.sql`。

普通访客没有登录和注册入口。右下角“+”只在管理员登录后显示。

访客提交“想要”后会获得商品五位对接码和平台统一的“卖方管理微信”。商品中填写的卖家微信只供管理员内部查看，不会返回给买家。

后台现在是独立的 `admin.html` 页面，支持详细统计、商品查询、买家记录查询、永久商品码查询、分类管理及管理员授权。商品删除或售出后，商品码仍保存在永久台账中，永远不会重新分配。

首页公告、首页标题下方描述和“网站介绍”均在后台“数据概览”中编辑。“网站介绍”支持换行文字、图片 URL 或本地上传图片；已有数据库执行 `supabase/upgrade-site-introduction-and-pinning.sql` 即可启用，也会补齐商品置顶字段，不会删除现有数据。

已有数据库如需启用“实时在线人数”、同一浏览器五分钟最多提交三次想要，以及“固定价格 / 面议 / 多少元及以下”三种价格方式，请执行 `supabase/upgrade-online-rate-limit-and-pricing.sql`。

网站介绍图片支持后台上传本地图片或填写 URL。后台“资源占用”页面每 15 秒更新 Supabase Storage、数据库、图片数量和合计容量；启用该页面需执行 `supabase/upgrade-resource-dashboard.sql`。

添加其他管理员前，先在 Supabase **Authentication → Users** 创建并确认该邮箱账号，然后进入独立后台的“管理员管理”，输入邮箱完成授权。

## 三、运行页面

不要直接双击 HTML。请在本目录打开终端并执行：

```powershell
python -m http.server 8080
```

浏览器访问：

```text
http://localhost:8080
```

如修改代码后没有变化，请按 `Ctrl + F5` 强制刷新。

## 功能

- 日间/夜间主题
- Supabase 动态分类和商品
- 分类与标题、描述、校区组合搜索
- 普通访客填写姓名、联系方式和备注后登记“想要”
- 同一商品支持多人想要，前台显示想要人数、总数量和剩余数量
- 管理员数据概览：商品、库存、待处理想要和累计想要
- 管理员发布、编辑、上下架、标记售罄和删除商品；危险操作均需二次确认
- 管理员添加、编辑和删除分类
- 管理员确认成交时自动扣减库存，取消已成交记录时自动返还库存
- 管理员确认、取消和删除想要记录；危险操作均需二次确认
- 管理员可以在商品编辑页勾选“🔝 置顶商品”，置顶商品会优先展示在前台
- 后台数据概览显示实时在线浏览器数；预定接口会限制同一浏览器五分钟内最多提交三次
- 商品价格支持固定金额、面议和“多少元及以下”
- 本地上传商品图和网站介绍图会压缩为 WebP，目标大小约 120KB 以内、最大边 1280 像素；外部 URL 图片直接引用，不占用 Storage
- 商品会自动分配 5 位数字对接码；买家提交后可复制对接码并查看统一的卖方管理微信
- Products/Categories Realtime 自动刷新
- 响应式布局和移动端横向分类栏

## Supabase 配置

项目 URL 和 Publishable key 位于 `assets/js/app.js` 顶部。当前已经填写为本项目配置。Publishable key 可以出现在浏览器代码中；不要把 service_role 或 secret key 写入前端。
