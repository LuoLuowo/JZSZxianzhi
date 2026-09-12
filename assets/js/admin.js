/* 焦大师专闲置好物平台 - 独立管理员后台 */
const SUPABASE_URL = 'https://znrnaeebnuadbxyqaild.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__uNRNeHvjKIMfIIdhQod6Q_KVqpmE3F';
const db = window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const state = {user:null,view:'overview',search:'',products:[],submissions:[],wallPosts:[],wallError:null,wallReports:[],wallReportError:null,reservations:[],notifications:[],codes:[],hotSearches:[],hotSearchError:null,admins:[],settings:{admin_wechat:'',announcement:'',hero_headline:'',hero_subtitle:'',introduction_content:'',introduction_image_url:'',wall_review_enabled:true},resources:{},confirmAction:null,editingProduct:null,channel:null,presenceChannel:null,onlineCount:0,visitorCount:0};
const viewMeta = {
  overview:['数据概览','查看平台实时运营数据'],products:['商品管理','查询商品、库存、交换微信和商品码'],submissions:['发布审核','审核普通用户提交的闲置'],campusWall:['投稿区审核','审核、置顶和管理投稿区内容'],wallReports:['举报反馈','查看并处理用户提交的投稿举报'],
  reservations:['想要记录','查询交换微信并处理成交'],codes:['商品码查询','查询当前和历史商品码'],
  resources:['资源占用','查看图片、Storage 和数据库实时占用'],categories:['分类管理','维护前台商品分类'],hotSearches:['热搜管理','添加、排序、启用或删除首页近期热搜'],admins:['管理员管理','授权其他管理员共同管理网站']
};
const productStatus = {available:'在售',sold:'已售罄',removed:'已下架'};
const reservationStatus = {pending:'待处理',confirmed:'已成交',cancelled:'已取消'};
const esc = (value='') => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateText = value => value ? new Date(value).toLocaleString('zh-CN') : '-';
const money = value => Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
const priceText = product => product.price_type==='negotiable'?(Number(product.price)>0?`面议<br><span class="hint">参考 ¥${money(product.price)}</span>`:'面议'):product.price_type==='at_most'?`¥${money(product.price)} 及以下`:`¥${money(product.price)}`;
function browserClientId(){const key='jzsf-browser-client-id';let id=localStorage.getItem(key);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'')){id=crypto.randomUUID();localStorage.setItem(key,id);}return id;}
const normalize = value => String(value||'').toLowerCase().trim();
const formatBytes = value => {const bytes=Number(value||0);if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`;if(bytes<1073741824)return `${(bytes/1048576).toFixed(2)} MB`;return `${(bytes/1073741824).toFixed(2)} GB`;};

function errorText(error) {
  const message = error?.message || String(error || '操作失败');
  if (/Invalid login credentials/i.test(message)) return '管理员邮箱或密码错误';
  if (/Email not confirmed/i.test(message)) return '邮箱尚未验证';
  if (/Failed to fetch|NetworkError/i.test(message)) return '网络连接失败，请稍后重试';
  if (/foreign key|violates foreign/i.test(message)) return '该分类仍有商品，不能删除';
  if (/permission|row-level|无权限/i.test(message)) return '当前账号没有管理员权限';
  return message;
}

let toastTimer;
function toast(message,ok=true) {
  $('toastIcon').textContent = ok?'✓':'!'; $('toastText').textContent = message;
  $('toast').classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);
}

function busy(button,on,label='处理中…') {
  if (!button) return;
  if (!button.dataset.original) button.dataset.original=button.textContent;
  button.disabled=on; button.textContent=on?label:button.dataset.original;
}

function askConfirm(title,text,label,action,primary=false) {
  state.confirmAction=action; $('adminConfirmTitle').textContent=title; $('adminConfirmText').textContent=text;
  $('adminConfirmAction').textContent=label; $('adminConfirmAction').className=`btn ${primary?'btn-primary':'btn-danger'}`;
  $('adminConfirmModal').classList.add('open');
}

function closeConfirm() { state.confirmAction=null; $('adminConfirmModal').classList.remove('open'); }
async function runConfirm() { const action=state.confirmAction; closeConfirm(); if(action) await action(); }

async function verifySession(session) {
  if (!session) return false;
  const {data,error}=await db.from('profiles').select('id,nickname,is_admin').eq('id',session.user.id).maybeSingle();
  if (error || !data?.is_admin) { await db.auth.signOut(); return false; }
  state.user={...session.user,profile:data}; return true;
}

async function showDashboard() {
  $('loginView').hidden=true; $('adminShell').hidden=false;
  $('adminAccount').textContent=state.user.email;
  updateDesktopNotificationButton(); await refreshData(); subscribeRealtime(); subscribePresence();
}

async function login(event) {
  event.preventDefault(); const button=$('pageLoginSubmit'); $('pageLoginError').textContent=''; busy(button,true,'验证中…');
  const {data,error}=await db.auth.signInWithPassword({email:$('pageAdminEmail').value.trim(),password:$('pageAdminPassword').value});
  if (error || !await verifySession(data?.session)) {
    $('pageLoginError').textContent=error?errorText(error):'该账号不是管理员'; busy(button,false); return;
  }
  busy(button,false); await showDashboard();
}

async function logout() { await db.auth.signOut(); location.replace('index.html'); }

async function refreshData() {
  $('adminPageContent').innerHTML='<div class="loading show">正在加载后台数据…</div>';
  const results=await Promise.all([
    db.from('products').select('*,categories(id,name,icon)').order('is_pinned',{ascending:false}).order('created_at',{ascending:false}),
    db.from('product_submissions').select('*,categories(id,name,icon)').order('created_at',{ascending:false}),
    db.from('reservations').select('*,products(id,title,connection_code)').neq('status','cancelled').order('created_at',{ascending:false}),
    db.from('admin_notifications').select('*').order('created_at',{ascending:false}).limit(200),
    db.from('product_code_registry').select('*').order('issued_at',{ascending:false}),
    db.from('categories').select('*').order('sort_order').order('id'),
    db.rpc('admin_list_admins'),
    db.from('site_settings').select('*').eq('id',true).maybeSingle(),
    db.rpc('admin_resource_usage'),
    db.rpc('admin_visitor_count'),
    db.from('hot_searches').select('*').order('sort_order').order('id'),
    db.from('campus_wall_posts').select('*').order('is_pinned',{ascending:false}).order('created_at',{ascending:false}),
    db.from('campus_wall_reports').select('*,campus_wall_posts(nickname,content,image_url)').order('created_at',{ascending:false})
  ]);
  const failed=results.slice(0,10).find(result=>result.error);
  if (failed) { $('adminPageContent').innerHTML=`<div class="empty show"><div class="empty-icon">!</div><div class="empty-title">后台数据加载失败</div><div>${esc(errorText(failed.error))}</div></div>`; return; }
  [state.products,state.submissions,state.reservations,state.notifications,state.codes,state.categories,state.admins]=results.slice(0,7).map(result=>result.data||[]);
  state.settings={admin_wechat:'',announcement:'',hero_headline:'',hero_subtitle:'',introduction_content:'',introduction_image_url:'',wall_review_enabled:true,...(results[7].data||{})};
  state.resources=results[8].data || {};
  state.visitorCount=Number(results[9].data || 0);
  state.hotSearches=results[10].data || [];
  state.hotSearchError=results[10].error || null;
  state.wallPosts=results[11].data || [];
  state.wallError=results[11].error || null;
  state.wallReports=results[12].data || [];
  state.wallReportError=results[12].error || null;
  state.products.sort((a,b)=>Number(a.status==='sold')-Number(b.status==='sold'));
  renderUnreadBadges();
  render();
}

function setView(view) {
  state.view=view; state.search=''; $('adminSearch').value='';
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  $('viewTitle').textContent=viewMeta[view][0]; $('viewDescription').textContent=viewMeta[view][1];
  const hints={overview:'概览无需查询',products:'商品名、商品码、交换微信',submissions:'商品名、交换微信、分类或审核状态',campusWall:'昵称、内容或审核状态',wallReports:'投稿内容、举报问题或处理状态',reservations:'商品、商品码、称呼、交换微信',codes:'输入五位商品码或商品名',resources:'图片标题或 URL',categories:'分类名称',hotSearches:'热搜关键词',admins:'管理员邮箱或昵称'};
  $('adminSearch').placeholder=hints[view]; $('adminSearch').disabled=view==='overview'; $('adminSearchButton').disabled=view==='overview'; render();
  if(view==='submissions')void markNotificationsRead('submission');
  if(view==='campusWall')void markNotificationsRead('campus_wall');
  if(view==='wallReports')void markNotificationsRead('wall_report');
  if(view==='reservations')void markNotificationsRead('reservation');
}

function renderUnreadBadges(){for(const [kind,id] of [['submission','unreadSubmissionsBadge'],['campus_wall','unreadWallBadge'],['wall_report','unreadWallReportsBadge'],['reservation','unreadReservationsBadge']]){const badge=$(id);if(!badge)continue;const count=state.notifications.filter(item=>item.kind===kind&&!item.is_read).length;badge.hidden=!count;badge.textContent=count>99?'99+':String(count);}}
async function markNotificationsRead(kind){const unread=state.notifications.filter(item=>item.kind===kind&&!item.is_read);if(!unread.length)return;const ids=unread.map(item=>item.id);const now=new Date().toISOString();const {error}=await db.from('admin_notifications').update({is_read:true,read_at:now}).in('id',ids);if(error)return;state.notifications=state.notifications.map(item=>ids.includes(item.id)?{...item,is_read:true,read_at:now}:item);renderUnreadBadges();}
function updateDesktopNotificationButton(){const button=$('desktopNotificationButton');if(!('Notification'in window)){button.hidden=true;return;}button.hidden=false;button.textContent=Notification.permission==='granted'?'🔔 电脑通知已开启':'🔔 开启电脑通知';}
async function requestDesktopNotifications(){if(!('Notification'in window))return toast('当前浏览器不支持电脑通知',false);if(Notification.permission==='denied')return toast('浏览器已拒绝通知，请在地址栏的网站权限中改为允许',false);const permission=await Notification.requestPermission();updateDesktopNotificationButton();toast(permission==='granted'?'电脑通知已开启':'未获得通知权限',permission==='granted');}
function showDesktopNotification(item){if(!('Notification'in window)||Notification.permission!=='granted')return;try{const notification=new Notification(`焦专好物平台 · ${item.title}`,{body:item.body||'请进入后台查看',icon:'assets/images/site-mark.webp',tag:`admin-notification-${item.id}`});notification.onclick=()=>{window.focus();setView(item.kind==='submission'?'submissions':item.kind==='campus_wall'?'campusWall':item.kind==='wall_report'?'wallReports':'reservations');notification.close();};}catch{}}
function handleNotificationChange(payload){if(payload.eventType!=='INSERT')return;const item=payload.new;if(!state.notifications.some(notification=>notification.id===item.id))state.notifications.unshift(item);renderUnreadBadges();showDesktopNotification(item);if((item.kind==='submission'&&state.view==='submissions')||(item.kind==='campus_wall'&&state.view==='campusWall')||(item.kind==='wall_report'&&state.view==='wallReports')||(item.kind==='reservation'&&state.view==='reservations'))void markNotificationsRead(item.kind);}

function render() {
  if (state.view==='overview') return renderOverview();
  if (state.view==='products') return renderProducts();
  if (state.view==='submissions') return renderSubmissions();
  if (state.view==='campusWall') return renderCampusWall();
  if (state.view==='wallReports') return renderWallReports();
  if (state.view==='reservations') return renderReservations();
  if (state.view==='codes') return renderCodes();
  if (state.view==='resources') return renderResources();
  if (state.view==='categories') return renderCategories();
  if (state.view==='hotSearches') return renderHotSearches();
  if (state.view==='admins') return renderAdmins();
}

function renderOverview() {
  const active=state.products.filter(p=>p.status==='available').length;
  const stock=state.products.reduce((sum,p)=>sum+Math.max(0,p.quantity-p.sold_quantity),0);
  const pending=state.reservations.filter(r=>r.status==='pending').length;
  const confirmed=state.reservations.filter(r=>r.status==='confirmed').length;
  $('adminPageContent').innerHTML=`<div class="dashboard-stats">
    ${[['实时在线人数',state.onlineCount,'hot'],['累计访问人数',state.visitorCount,'hot'],['待审核发布',state.submissions.filter(item=>item.status==='pending').length],['待审投稿区',state.wallPosts.filter(item=>item.status==='pending').length],['商品总数',state.products.length],['在售商品',active],['剩余库存',stock],['累计商品码',state.codes.length],['想要记录',state.reservations.length],['待处理',pending],['已成交',confirmed],['近期热搜',state.hotSearches.filter(item=>item.is_active).length],['管理员',state.admins.length]].map(item=>`<div class="dashboard-card ${item[2]||''}"><span>${item[0]}</span><strong>${item[1]}</strong></div>`).join('')}
  </div><section class="dashboard-section"><h2>前台展示设置</h2><form id="siteSettingsForm"><div class="field-group"><label class="label" for="managementWechatInput">平台备用交换微信</label><input class="field" id="managementWechatInput" maxlength="120" value="${esc(state.settings.admin_wechat||'')}" placeholder="仅后台留存，当前交换流程不会显示"><div class="hint">用户登记后会直接看到对应商品填写的交换微信。</div></div><div class="field-group"><label class="label" for="heroSubtitleInput">首页标题下方描述</label><textarea class="field" id="heroSubtitleInput" maxlength="500" placeholder="首页主标题下方的简介文字">${esc(state.settings.hero_subtitle||'')}</textarea></div><div class="field-group"><label class="label" for="announcementInput">公告内容</label><textarea class="field" id="announcementInput" maxlength="2000" placeholder="留空则不显示公告">${esc(state.settings.announcement||'')}</textarea></div><div class="field-group"><label class="label" for="introductionContentInput">学长介绍文字</label><div class="rich-editor-toolbar"><button type="button" data-introduction-red>红色字体</button><span class="hint">选中文字后点击</span></div><div class="field rich-editor" id="introductionContentInput" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="支持换行；选中文字后按 Ctrl+B 可加粗"></div><div class="hint">支持换行；Ctrl+B 加粗；选中文字后可切换红色。</div></div><div class="field-row"><div class="field-group"><label class="label" for="introductionImageInput">介绍图片 URL</label><input class="field" id="introductionImageInput" type="url" value="${esc(state.settings.introduction_image_url||'')}" placeholder="任意可显示的图片直链"></div><div class="field-group"><label class="label" for="introductionImageFile">上传介绍图片</label><input class="field" id="introductionImageFile" type="file" accept="image/*"><div class="hint">本地图片会压缩为约 150KB 以内的 WebP；上传文件优先于 URL。</div></div></div>${state.settings.introduction_image_url?`<div class="settings-qr-current"><img class="settings-qr-preview" src="${esc(state.settings.introduction_image_url)}" alt="当前学长介绍图片"><button class="btn btn-danger btn-small" type="button" data-delete-introduction-image>删除图片</button></div>`:''}<button class="btn btn-primary" type="submit">保存前台展示设置</button></form></section><section class="dashboard-section"><h2>最近想要记录</h2>${reservationTable(state.reservations.slice(0,5),false)}</section>`;
  $('introductionContentInput').innerHTML=sanitizeIntroductionHtml(state.settings.introduction_content||'');
  $('heroSubtitleInput').closest('.field-group').insertAdjacentHTML('beforebegin',`<div class="field-group"><label class="label" for="heroHeadlineInput">搜索栏上方标题</label><input class="field" id="heroHeadlineInput" maxlength="200" value="${esc(state.settings.hero_headline||'')}" placeholder="如：发现校园好物"></div>`);
}

function filtered(items,fields) { const term=normalize(state.search); return !term?items:items.filter(item=>fields(item).some(value=>normalize(value).includes(term))); }
function sanitizeIntroductionHtml(value) {const template=document.createElement('template');template.innerHTML=String(value||'');const allowed=new Set(['STRONG','B','BR','DIV','P','SPAN','FONT']);const clean=node=>{if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent||'');if(node.nodeType!==Node.ELEMENT_NODE)return document.createDocumentFragment();const fragment=document.createDocumentFragment();for(const child of [...node.childNodes])fragment.append(clean(child));if(!allowed.has(node.tagName))return fragment;const color=String(node.getAttribute?.('color')||node.style?.color||'').toLowerCase().replace(/\s/g,'');if((node.tagName==='SPAN'||node.tagName==='FONT')&&!node.classList?.contains('intro-red')&&!['#e64b4b','rgb(230,75,75)','red'].includes(color))return fragment;const tag=node.tagName==='B'?'strong':node.tagName==='FONT'?'span':node.tagName.toLowerCase();const element=document.createElement(tag);if(node.tagName==='SPAN'||node.tagName==='FONT')element.className='intro-red';element.append(fragment);return element;};const output=document.createElement('div');for(const child of [...template.content.childNodes])output.append(clean(child));return output.innerHTML;}
function table(headers,rows) { return `<div class="data-card"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td class="empty-row" colspan="${headers.length}">没有找到相关数据</td></tr>`}</tbody></table></div>`; }

function renderProducts() {
  const data=filtered(state.products,p=>[p.title,p.description,p.connection_code,p.campus,p.seller_contact,p.categories?.name,p.status]);
  $('adminPageContent').innerHTML=table(['图片','商品码 / 商品','价格与分类','库存','交换微信','状态 / 时间','操作'],data.map(p=>`<tr><td>${p.image_url?`<img class="table-thumb" src="${esc(p.image_url)}" alt="${esc(p.title)}">`:'<div class="table-thumb">📦</div>'}</td><td><div class="code">${esc(p.connection_code)}</div><strong>${p.is_pinned?'🔝 ':''}${p.is_recommended?'⭐ ':''}${esc(p.title)}</strong><div class="hint">${esc(p.description)}</div></td><td>${priceText(p)}<br>${esc(p.categories?.icon||'📦')} ${esc(p.categories?.name||'未分类')}<br>${esc(p.campus)} · ${esc(p.condition)}</td><td>总数 ${p.quantity}<br>已售 ${p.sold_quantity}<br>剩余 ${p.quantity-p.sold_quantity}</td><td class="private-data">${esc(p.seller_contact||'未填写')}</td><td>${productStatus[p.status]||p.status}<br><span class="hint">${dateText(p.created_at)}</span></td><td><div class="actions"><button class="btn btn-ghost btn-small" data-edit-product="${p.id}">编辑</button>${p.status!=='sold'?`<button class="btn btn-primary btn-small" data-product-status="sold" data-id="${p.id}">标记售罄</button>`:''}${p.status!=='removed'?`<button class="btn btn-ghost btn-small" data-product-status="removed" data-id="${p.id}">下架</button>`:`<button class="btn btn-ghost btn-small" data-product-status="available" data-id="${p.id}">上架</button>`}<button class="btn btn-danger btn-small" data-delete-product="${p.id}">删除</button></div></td></tr>`).join(''));
}

function renderSubmissions() {
  const labels={pending:'待审核',approved:'已通过',rejected:'已拒绝'};
  const data=filtered(state.submissions,s=>[s.title,s.description,s.seller_contact,s.categories?.name,s.status]);
  $('adminPageContent').innerHTML=table(['图片','商品与发布者','价格与分类','库存','审核状态 / 时间','操作'],data.map(s=>`<tr><td>${s.image_url?`<img class="table-thumb" src="${esc(s.image_url)}" alt="${esc(s.title)}">`:'<div class="table-thumb">📦</div>'}</td><td><strong>${esc(s.title)}</strong><div class="hint">${esc(s.description||'未填写描述')}</div><div class="private-data">交换微信：${esc(s.seller_contact)}</div></td><td>${priceText(s)}<br>${esc(s.categories?.icon||'📦')} ${esc(s.categories?.name||'未分类')}<br>${esc(s.condition)}</td><td>数量 ${s.quantity}</td><td>${labels[s.status]||s.status}<br><span class="hint">${dateText(s.created_at)}</span></td><td>${s.status==='pending'?`<div class="actions"><button class="btn btn-primary btn-small" data-review-submission="${s.id}" data-review-action="approved">审核通过并上架</button><button class="btn btn-danger btn-small" data-review-submission="${s.id}" data-review-action="rejected">拒绝</button></div>`:s.status==='rejected'?`<button class="btn btn-danger btn-small" data-delete-submission="${s.id}">删除记录</button>`:'—'}</td></tr>`).join(''));
}

function renderCampusWall() {
  if(state.wallError){$('adminPageContent').innerHTML='<div class="empty show"><div class="empty-icon">!</div><div class="empty-title">投稿区数据库尚未升级</div><div>请先执行 supabase/upgrade-campus-wall-and-exchange.sql</div></div>';return;}
  const labels={pending:'待审核',approved:'已通过',rejected:'已拒绝'};
  const data=filtered(state.wallPosts,item=>[item.nickname,item.content,item.status,item.approval_source,item.is_pinned?'置顶':'']);
  $('adminPageContent').innerHTML=`<div class="toolbar-row"><div><strong>投稿区审核模式</strong><div class="hint">开启后投稿进入审核列表；关闭后符合规则的投稿会直接发布。</div></div><div class="actions"><button class="btn ${state.settings.wall_review_enabled!==false?'btn-primary':'btn-ghost'}" type="button" data-wall-review-mode="true">开启审核模式</button><button class="btn ${state.settings.wall_review_enabled===false?'btn-primary':'btn-ghost'}" type="button" data-wall-review-mode="false">关闭审核模式</button></div></div>`+table(['照片','昵称 / 投稿内容','状态 / 时间','置顶','操作'],data.map(item=>{const statusLabel=item.status==='approved'&&item.approval_source==='automatic'?'自动通过':labels[item.status]||item.status;return `<tr><td>${item.image_url?`<img class="wall-admin-image" src="${esc(item.image_url)}" alt="投稿图片">`:'—'}</td><td><strong>${esc(item.nickname)}</strong><div class="wall-admin-content">${esc(item.content)}</div></td><td>${statusLabel}<br><span class="hint">${dateText(item.created_at)}</span></td><td>${item.is_pinned?'🔝 已置顶':'普通'}</td><td><div class="actions">${item.status==='pending'?`<button class="btn btn-primary btn-small" data-review-wall="${item.id}" data-wall-action="approved">同意发布</button><button class="btn btn-danger btn-small" data-review-wall="${item.id}" data-wall-action="rejected">拒绝</button>`:''}${item.status==='approved'?`<button class="btn btn-ghost btn-small" data-pin-wall="${item.id}" data-pin-value="${item.is_pinned?'false':'true'}">${item.is_pinned?'取消置顶':'🔝 置顶'}</button>`:''}<button class="btn btn-danger btn-small" data-delete-wall="${item.id}">删除</button></div></td></tr>`}).join(''));
}

function renderWallReports(){
  if(state.wallReportError){$('adminPageContent').innerHTML='<div class="empty show"><div class="empty-icon">!</div><div class="empty-title">举报功能数据库尚未升级</div><div>请先执行 supabase/upgrade-wall-post-tools.sql</div></div>';return;}
  const labels={pending:'待处理',handled:'已处理'};
  const data=filtered(state.wallReports,item=>[item.reason,item.status,item.campus_wall_posts?.nickname,item.campus_wall_posts?.content]);
  $('adminPageContent').innerHTML=table(['投稿内容','举报问题','状态 / 时间','操作'],data.map(item=>`<tr><td><strong>${esc(item.campus_wall_posts?.nickname||'投稿已删除')}</strong><div class="wall-admin-content">${esc(item.campus_wall_posts?.content||'原投稿已不存在')}</div>${item.campus_wall_posts?.image_url?`<img class="wall-admin-image" src="${esc(item.campus_wall_posts.image_url)}" alt="投稿图片">`:''}</td><td>${esc(item.reason)}</td><td>${labels[item.status]||item.status}<br><span class="hint">${dateText(item.created_at)}</span></td><td><div class="actions">${item.status==='pending'?`<button class="btn btn-primary btn-small" data-handle-wall-report="${item.id}">标记已处理</button>`:''}<button class="btn btn-danger btn-small" data-delete-wall-report="${item.id}">删除反馈</button></div></td></tr>`).join(''));
}

function reservationTable(records,actions=true) {
  return table(['商品码 / 商品','称呼','交换微信','状态 / 时间',...(actions?['操作']:[])],records.map(r=>`<tr><td><div class="code">${esc(r.products?.connection_code||'-')}</div>${esc(r.products?.title||'商品已删除')}</td><td>${esc(r.buyer_name)}</td><td class="private-data">${esc(r.contact)}</td><td>${reservationStatus[r.status]||r.status}<br><span class="hint">${dateText(r.created_at)}</span></td>${actions?`<td><div class="actions">${r.status==='pending'?`<button class="btn btn-primary btn-small" data-reservation-status="confirmed" data-id="${r.id}">确认成交</button><button class="btn btn-ghost btn-small" data-reservation-status="cancelled" data-id="${r.id}">取消</button>`:''}<button class="btn btn-danger btn-small" data-delete-reservation="${r.id}">删除</button></div></td>`:''}</tr>`).join(''));
}
function renderReservations() { const data=filtered(state.reservations,r=>[r.products?.title,r.products?.connection_code,r.buyer_name,r.contact,r.status]); $('adminPageContent').innerHTML=reservationTable(data); }

function renderCodes() {
  const data=filtered(state.codes,c=>[c.code,c.product_title]);
  $('adminPageContent').innerHTML=table(['永久商品码','商品名称','当前状态','生成时间'],data.map(c=>{const product=state.products.find(p=>p.id===c.product_id);return `<tr><td><button class="btn btn-ghost code" data-copy-code="${c.code}">${c.code}</button></td><td>${esc(c.product_title)}</td><td>${product?(productStatus[product.status]||product.status):'商品已删除（编码永久保留）'}</td><td>${dateText(c.issued_at)}</td></tr>`}).join(''));
}

function renderResources() {
  const usage=state.resources||{};
  const imageItems=state.products.filter(p=>p.image_url).map(p=>({title:p.title,url:p.image_url,code:p.connection_code}));
  state.wallPosts.filter(p=>p.image_url).forEach(p=>imageItems.push({title:`投稿区：${p.title}`,url:p.image_url,code:'投稿区'}));
  if(state.settings.introduction_image_url)imageItems.unshift({title:'学长介绍图片',url:state.settings.introduction_image_url,code:'介绍图'});
  const images=filtered(imageItems,p=>[p.title,p.url,p.code]);
  $('adminPageContent').innerHTML=`<div class="toolbar-row"><span class="hint">统计范围：Supabase 数据库与 product-images 存储桶；外链图片不占用 Supabase Storage。</span><button class="btn btn-primary" data-refresh-resources>刷新统计</button></div><div class="dashboard-stats">
    ${[['网站资源合计',formatBytes(usage.total_bytes)],['Storage 图片',formatBytes(usage.storage_bytes)],['数据库',formatBytes(usage.database_bytes)],['存储文件数',usage.storage_image_count||0],['业务图片数',usage.product_image_count||0],['外链图片数',usage.external_image_count||0]].map(item=>`<div class="dashboard-card"><span>${item[0]}</span><strong>${item[1]}</strong></div>`).join('')}
  </div><section class="dashboard-section"><h2>实时图片（${images.length}）</h2><div class="resource-gallery">${images.map(p=>`<article><img src="${esc(p.url)}" alt="${esc(p.title)}" loading="lazy"><div><strong>${esc(p.title)}</strong><span>${p.url.includes('/storage/v1/object/public/product-images/')?'Storage':'外部 URL'}</span></div></article>`).join('')||'<p class="hint">暂无图片</p>'}</div></section>`;
}

async function refreshResources() {const {data,error}=await db.rpc('admin_resource_usage');if(error)return toast(errorText(error),false);state.resources=data||{};if(state.view==='resources')renderResources();}

function renderCategories() {
  const data=filtered(state.categories,c=>[c.name,c.icon]);
  $('adminPageContent').innerHTML=`<div class="toolbar-row"><form id="addCategoryForm"><div class="field-group"><label class="label">图标</label><input class="field" name="icon" maxlength="8" required value="📦"></div><div class="field-group"><label class="label">新分类名称</label><input class="field" name="name" maxlength="30" required></div><div class="field-group"><label class="label">排序</label><input class="field" name="sort" type="number" required value="0"></div><button class="btn btn-primary" type="submit">添加分类</button></form></div>`+table(['图标','名称','排序','启用','操作'],data.map(c=>`<tr><td><input class="field" id="cat-icon-${c.id}" maxlength="8" value="${esc(c.icon)}"></td><td><input class="field" id="cat-name-${c.id}" maxlength="30" value="${esc(c.name)}"></td><td><input class="field" id="cat-sort-${c.id}" type="number" value="${c.sort_order}"></td><td>${c.is_active?'是':'否'}</td><td><div class="actions"><button class="btn btn-primary btn-small" data-save-category="${c.id}">保存</button><button class="btn btn-danger btn-small" data-delete-category="${c.id}">删除</button></div></td></tr>`).join(''));
}

function renderHotSearches() {
  if(state.hotSearchError){$('adminPageContent').innerHTML='<div class="empty show"><div class="empty-icon">!</div><div class="empty-title">热搜表尚未初始化</div><div>请先在 Supabase SQL Editor 执行 supabase/upgrade-hot-searches.sql</div></div>';return;}
  const data=filtered(state.hotSearches,item=>[item.keyword,item.sort_order,item.is_active?'启用':'停用']);
  $('adminPageContent').innerHTML=`<div class="toolbar-row"><form id="addHotSearchForm"><div class="field-group"><label class="label">热搜关键词</label><input class="field" name="keyword" maxlength="40" required placeholder="如：考研资料"></div><div class="field-group"><label class="label">排序</label><input class="field" name="sort" type="number" required value="0"></div><button class="btn btn-primary" type="submit">添加热搜</button></form></div>`+table(['火爆标识','关键词','排序','前台显示','操作'],data.map(item=>`<tr><td>🔥</td><td><input class="field" id="hot-keyword-${item.id}" maxlength="40" value="${esc(item.keyword)}"></td><td><input class="field" id="hot-sort-${item.id}" type="number" value="${item.sort_order}"></td><td><label><input id="hot-active-${item.id}" type="checkbox" ${item.is_active?'checked':''}> 启用</label></td><td><div class="actions"><button class="btn btn-primary btn-small" data-save-hot-search="${item.id}">保存</button><button class="btn btn-danger btn-small" data-delete-hot-search="${item.id}">删除</button></div></td></tr>`).join(''));
}

function renderAdmins() {
  const data=filtered(state.admins,a=>[a.email,a.nickname]);
  $('adminPageContent').innerHTML=`<div class="dashboard-section" style="margin-top:0"><h2>添加管理员</h2><form id="grantAdminForm" class="admin-query"><input class="field" name="email" type="email" required placeholder="已在 Authentication 创建的邮箱"><button class="btn btn-primary" type="submit">授权管理员</button></form><p class="hint" style="margin-top:10px">出于安全原因，请先在 Supabase Authentication → Users 创建并确认该邮箱账号，再在这里授权。</p></div>`+table(['管理员邮箱','昵称','授权时间'],data.map(a=>`<tr><td>${esc(a.email)}</td><td>${esc(a.nickname)}</td><td>${dateText(a.created_at)}</td></tr>`).join(''));
}

async function grantAdmin(event) { event.preventDefault(); const button=event.submitter; busy(button,true,'授权中…'); const {error}=await db.rpc('admin_grant_admin',{p_email:new FormData(event.target).get('email')}); busy(button,false); if(error)return toast(errorText(error),false); toast('管理员授权成功'); event.target.reset(); await refreshData(); }

async function compressAdminImage(file) {
  if(!file.type.startsWith('image/'))throw new Error('请选择图片文件');
  if(file.size>20*1024*1024)throw new Error('原图不能超过 20MB');
  const objectUrl=URL.createObjectURL(file);
  try{const image=new Image();image.src=objectUrl;await image.decode();const target=120*1024;let scale=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight)),quality=.84,output;for(let i=0;i<18;i++){const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d',{alpha:false}).drawImage(image,0,0,canvas.width,canvas.height);output=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(!output)throw new Error('图片转换失败');if(output.size<=target)break;if(quality>.42)quality-=.07;else{scale*=.82;quality=.68;}}if(!output||output.size>target)throw new Error('压缩后仍超过 120KB，请换一张图片');return output;}finally{URL.revokeObjectURL(objectUrl);}
}
function storagePath(url){const marker='/storage/v1/object/public/product-images/';const index=String(url||'').indexOf(marker);return index<0?null:decodeURIComponent(url.slice(index+marker.length));}
async function uploadIntroductionImage(file){const blob=await compressAdminImage(file);const path=`admin/introduction-${crypto.randomUUID?crypto.randomUUID():Date.now()}.webp`;const {error}=await db.storage.from('product-images').upload(path,new File([blob],'introduction.webp',{type:'image/webp'}),{contentType:'image/webp',cacheControl:'31536000'});if(error)throw error;return {url:db.storage.from('product-images').getPublicUrl(path).data.publicUrl,path};}

function openProductEditor(id) {
  const product=state.products.find(item=>item.id===id);
  if(!product)return toast('没有找到该商品',false);
  state.editingProduct=product;
  $('adminProductForm').reset();
  $('editProductError').textContent='';
  $('editProductCode').textContent=product.connection_code||'生成中';
  $('editProductTitle').value=product.title||'';
  $('editProductDescription').value=product.description||'';
  $('editProductPrice').value=product.price;
  $('editProductPriceType').value=product.price_type||'fixed';
  updateEditProductPriceInput();
  $('editProductCondition').value=product.condition||'轻微使用痕迹';
  $('editProductCategory').innerHTML=state.categories.map(category=>`<option value="${category.id}">${esc(category.icon)} ${esc(category.name)}</option>`).join('');
  $('editProductCategory').value=product.category_id;
  $('editProductStatus').value=product.status;
  $('editProductQuantity').value=product.quantity;
  $('editProductSoldQuantity').value=product.sold_quantity;
  $('editProductPinned').checked=Boolean(product.is_pinned);
  $('editProductRecommended').checked=Boolean(product.is_recommended);
  $('editSellerContact').value=product.seller_contact||'';
  $('editProductImageUrl').value=product.image_url||'';
  $('editProductImageHint').textContent='上传新图片会替换当前图片，并压缩为约 120KB 以内的 WebP。';
  $('adminProductModal').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeProductEditor() {
  state.editingProduct=null;
  $('adminProductModal').classList.remove('open');
  if(!$('adminConfirmModal').classList.contains('open'))document.body.style.overflow='';
}

async function uploadProductImage(file) {
  const blob=await compressAdminImage(file);
  const path=`admin/${crypto.randomUUID?crypto.randomUUID():Date.now()}.webp`;
  const {error}=await db.storage.from('product-images').upload(path,new File([blob],'product.webp',{type:'image/webp'}),{contentType:'image/webp',cacheControl:'31536000'});
  if(error)throw error;
  return {url:db.storage.from('product-images').getPublicUrl(path).data.publicUrl,path,size:blob.size};
}

async function saveProductEdit(event) {
  event.preventDefault();
  const product=state.editingProduct;
  if(!product)return;
  const button=event.submitter;
  if(!event.confirmed&&product.status!=='sold'&&$('editProductStatus').value==='sold'){
    return askConfirm('确认标记售罄',`确定要在保存修改时将“${product.title}”标记为售罄吗？系统会把已售数量同步为商品总数量。`,'确认售罄',()=>saveProductEdit({preventDefault(){},submitter:button,confirmed:true}),true);
  }
  const file=$('editProductImageFile').files[0];
  let uploaded=null;
  $('editProductError').textContent='';
  busy(button,true,file?'压缩并上传中…':'保存中…');
  try{
    const quantity=Number($('editProductQuantity').value),soldQuantity=Number($('editProductSoldQuantity').value);
    if(soldQuantity>quantity)throw new Error('已售数量不能大于商品总数量');
    let imageUrl=$('editProductImageUrl').value.trim()||null;
    if(file){uploaded=await uploadProductImage(file);imageUrl=uploaded.url;}
    else if(imageUrl){let parsed;try{parsed=new URL(imageUrl);}catch{throw new Error('图片 URL 格式不正确');}if(!['http:','https:'].includes(parsed.protocol))throw new Error('图片 URL 必须以 http 或 https 开头');imageUrl=parsed.href;}
    let status=$('editProductStatus').value;
    let finalSold=soldQuantity;
    if(status==='sold')finalSold=quantity;
    if(status==='available'&&finalSold>=quantity)throw new Error('在售商品的已售数量必须小于商品总数量');
    const priceType=$('editProductPriceType').value;
    const price=Number($('editProductPrice').value||0);
    if(!Number.isFinite(price)||price<0)throw new Error('请输入正确的价格');
    const payload={title:$('editProductTitle').value.trim(),description:$('editProductDescription').value.trim(),price,price_type:priceType,condition:$('editProductCondition').value,category_id:Number($('editProductCategory').value),quantity,sold_quantity:finalSold,seller_contact:$('editSellerContact').value.trim()||null,status,image_url:imageUrl,is_pinned:$('editProductPinned').checked,is_recommended:$('editProductRecommended').checked};
    const {error}=await db.from('products').update(payload).eq('id',product.id);
    if(error)throw error;
    const oldPath=storagePath(product.image_url);
    if((uploaded||imageUrl!==product.image_url)&&oldPath)await db.storage.from('product-images').remove([oldPath]);
    toast(`商品已保存${uploaded?`，图片 ${Math.round(uploaded.size/1024)}KB`:''}`);
    closeProductEditor();
    await refreshData();
  }catch(error){if(uploaded?.path)await db.storage.from('product-images').remove([uploaded.path]);$('editProductError').textContent=errorText(error);}
  finally{busy(button,false);}
}
async function saveSiteSettings(event) {event.preventDefault();const button=event.submitter;const file=$('introductionImageFile').files[0];let uploaded=null;busy(button,true,file?'上传介绍图片中…':'保存中…');try{if(file)uploaded=await uploadIntroductionImage(file);let imageUrl=uploaded?.url||$('introductionImageInput').value.trim()||null;if(imageUrl){let parsed;try{parsed=new URL(imageUrl);}catch{throw new Error('介绍图片 URL 格式不正确');}if(!['http:','https:'].includes(parsed.protocol))throw new Error('介绍图片 URL 必须以 http 或 https 开头');imageUrl=parsed.href;}const introductionContent=sanitizeIntroductionHtml($('introductionContentInput').innerHTML);if(introductionContent.length>5000)throw new Error('学长介绍文字不能超过 5000 个字符');const payload={admin_wechat:$('managementWechatInput').value.trim(),hero_headline:$('heroHeadlineInput').value.trim(),hero_subtitle:$('heroSubtitleInput').value.trim(),announcement:$('announcementInput').value.trim(),introduction_content:introductionContent,introduction_image_url:imageUrl,updated_at:new Date().toISOString()};const {error}=await db.from('site_settings').update(payload).eq('id',true);if(error)throw error;const oldPath=storagePath(state.settings.introduction_image_url);if(uploaded&&oldPath&&oldPath!==uploaded.path)await db.storage.from('product-images').remove([oldPath]);state.settings={...state.settings,...payload};toast('前台展示设置已保存');await refreshData();}catch(error){if(uploaded?.path)await db.storage.from('product-images').remove([uploaded.path]);toast(errorText(error),false);}finally{busy(button,false);}}
async function setWallReviewMode(enabled){const {error}=await db.from('site_settings').update({wall_review_enabled:enabled,updated_at:new Date().toISOString()}).eq('id',true);if(error)return toast(errorText(error),false);state.settings.wall_review_enabled=enabled;toast(enabled?'投稿区已开启审核模式':'投稿区已关闭审核模式，投稿将直接发布');await refreshData();}
async function deleteIntroductionImage() {const url=state.settings.introduction_image_url;if(!url)return;const {error}=await db.from('site_settings').update({introduction_image_url:null,updated_at:new Date().toISOString()}).eq('id',true);if(error)return toast(errorText(error),false);const path=storagePath(url);if(path)await db.storage.from('product-images').remove([path]);toast('学长介绍图片已删除');await refreshData();}
function requestDeleteIntroductionImage() {askConfirm('删除学长介绍图片','确定删除当前学长介绍图片吗？前台介绍弹窗将只保留文字内容。','删除图片',deleteIntroductionImage);}

async function setProductStatus(id,status) {
  const product=state.products.find(p=>p.id===id); const payload={status};
  if(status==='sold')payload.sold_quantity=product.quantity;
  if(status==='available'&&product.sold_quantity>=product.quantity)payload.sold_quantity=0;
  const {error}=await db.from('products').update(payload).eq('id',id); if(error)return toast(errorText(error),false); toast('商品状态已更新'); await refreshData();
}
async function deleteProduct(id) { const product=state.products.find(p=>p.id===id); const {error}=await db.from('products').delete().eq('id',id); if(error)return toast(errorText(error),false); if(product?.image_url){const marker='/storage/v1/object/public/product-images/';const i=product.image_url.indexOf(marker);if(i>=0)await db.storage.from('product-images').remove([decodeURIComponent(product.image_url.slice(i+marker.length))]);} toast('商品已删除，商品码已永久保留'); await refreshData(); }
async function setReservationStatus(id,status) { const {error}=await db.rpc('admin_set_reservation_status',{p_reservation_id:id,p_status:status}); if(error)return toast(errorText(error),false); if(status==='cancelled'){const removed=await db.from('reservations').delete().eq('id',id);if(removed.error)return toast(errorText(removed.error),false);toast('已取消并移除该想要记录');}else toast('已确认成交');await refreshData(); }
async function deleteReservation(id) { const {error}=await db.from('reservations').delete().eq('id',id); if(error)return toast(errorText(error),false); toast('想要记录已删除'); await refreshData(); }
async function addCategory(form) { const data=new FormData(form);const {error}=await db.from('categories').insert({name:String(data.get('name')).trim(),icon:String(data.get('icon')).trim(),sort_order:Number(data.get('sort'))});if(error)return toast(errorText(error),false);toast('分类已添加');await refreshData(); }
async function saveCategory(id) { const {error}=await db.from('categories').update({name:$(`cat-name-${id}`).value.trim(),icon:$(`cat-icon-${id}`).value.trim(),sort_order:Number($(`cat-sort-${id}`).value)}).eq('id',id);if(error)return toast(errorText(error),false);toast('分类已保存');await refreshData(); }
async function deleteCategory(id) { const {error}=await db.from('categories').delete().eq('id',id);if(error)return toast(errorText(error),false);toast('分类已删除');await refreshData(); }
async function addHotSearch(form) {const data=new FormData(form);const {error}=await db.from('hot_searches').insert({keyword:String(data.get('keyword')).trim(),sort_order:Number(data.get('sort')),is_active:true});if(error)return toast(errorText(error),false);toast('热搜已添加');await refreshData();}
async function saveHotSearch(id) {const {error}=await db.from('hot_searches').update({keyword:$(`hot-keyword-${id}`).value.trim(),sort_order:Number($(`hot-sort-${id}`).value),is_active:$(`hot-active-${id}`).checked}).eq('id',id);if(error)return toast(errorText(error),false);toast('热搜已保存');await refreshData();}
async function deleteHotSearch(id) {const {error}=await db.from('hot_searches').delete().eq('id',id);if(error)return toast(errorText(error),false);toast('热搜已删除');await refreshData();}

async function copyCode(code) { try{await navigator.clipboard.writeText(code);toast('商品码已复制');}catch{toast('复制失败，请手动复制',false);} }
async function reviewSubmission(id,action) { const {error}=await db.rpc('admin_review_submission',{p_submission_id:id,p_action:action});if(error)return toast(errorText(error),false);toast(action==='approved'?'审核通过，商品已上架':'已拒绝该闲置发布');await refreshData(); }
async function deleteRejectedSubmission(id) {const submission=state.submissions.find(item=>item.id===id);if(!submission||submission.status!=='rejected')return toast('仅已拒绝的发布记录可以删除',false);const {error}=await db.from('product_submissions').delete().eq('id',id).eq('status','rejected');if(error)return toast(errorText(error),false);const path=storagePath(submission.image_url);let storageError=null;if(path?.startsWith('submissions/'))({error:storageError}=await db.storage.from('product-images').remove([path]));toast(storageError?'记录已删除，但图片清理失败，请稍后在资源占用中处理':'已删除拒绝记录并清理本地图片',!storageError);await refreshData();}
async function reviewWallPost(id,action){const {error}=await db.rpc('admin_review_campus_wall_post',{p_post_id:id,p_action:action});if(error)return toast(errorText(error),false);toast(action==='approved'?'投稿区内容已发布':'投稿区内容已拒绝');await refreshData();}
async function setWallPinned(id,value){const {error}=await db.from('campus_wall_posts').update({is_pinned:value}).eq('id',id).eq('status','approved');if(error)return toast(errorText(error),false);toast(value?'投稿区内容已置顶':'已取消置顶');await refreshData();}
async function deleteWallPost(id){const item=state.wallPosts.find(post=>post.id===id);const {error}=await db.from('campus_wall_posts').delete().eq('id',id);if(error)return toast(errorText(error),false);const path=storagePath(item?.image_url);if(path?.startsWith('wall-submissions/'))await db.storage.from('product-images').remove([path]);toast('投稿区内容已删除');await refreshData();}
async function handleWallReport(id){const {error}=await db.from('campus_wall_reports').update({status:'handled',handled_at:new Date().toISOString(),handled_by:state.user.id}).eq('id',id);if(error)return toast(errorText(error),false);toast('举报反馈已标记为处理');await refreshData();}
async function deleteWallReport(id){const {error}=await db.from('campus_wall_reports').delete().eq('id',id);if(error)return toast(errorText(error),false);toast('举报反馈已删除');await refreshData();}

function bindEvents() {
  $('adminPageLoginForm').addEventListener('submit',login); $('adminPageLogout').addEventListener('click',logout);
  $('desktopNotificationButton').addEventListener('click',requestDesktopNotifications);
  $('adminThemeButton').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('jzsf-admin-theme',theme);$('adminThemeButton').textContent=theme==='dark'?'☀️':'🌙';});
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
  $('adminSearchButton').addEventListener('click',()=>{state.search=$('adminSearch').value;render();});
  $('adminSearch').addEventListener('input',()=>{state.search=$('adminSearch').value;render();});
  $('adminSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();state.search=event.target.value;render();}});
  $('adminConfirmCancel').addEventListener('click',closeConfirm); $('adminConfirmClose').addEventListener('click',closeConfirm); $('adminConfirmAction').addEventListener('click',runConfirm);
  $('adminProductForm').addEventListener('submit',saveProductEdit); $('adminProductClose').addEventListener('click',closeProductEditor); $('editProductPriceType').addEventListener('change',updateEditProductPriceInput);
  $('adminConfirmModal').addEventListener('click',event=>{if(event.target===$('adminConfirmModal'))closeConfirm();});
  $('adminPageContent').addEventListener('mousedown',event=>{if(event.target.closest('[data-introduction-red]'))event.preventDefault();});
  $('adminPageContent').addEventListener('submit',event=>{event.preventDefault();if(event.target.id==='siteSettingsForm')return saveSiteSettings(event);if(event.target.id==='grantAdminForm')return grantAdmin(event);if(event.target.id==='addCategoryForm')return addCategory(event.target);if(event.target.id==='addHotSearchForm')return addHotSearch(event.target);});
  $('adminPageContent').addEventListener('click',event=>{
    const target=event.target;
    if(target.closest('[data-refresh-resources]'))return refreshResources();
    const wallReviewMode=target.closest('[data-wall-review-mode]');
    if(wallReviewMode)return setWallReviewMode(wallReviewMode.dataset.wallReviewMode==='true');
    if(target.closest('[data-delete-introduction-image]'))return requestDeleteIntroductionImage();
    if(target.closest('[data-introduction-red]')){const editor=$('introductionContentInput');editor.focus();document.execCommand('foreColor',false,'#e64b4b');return;}
    if(target.dataset.copyCode)return copyCode(target.dataset.copyCode);
    if(target.dataset.editProduct)return openProductEditor(target.dataset.editProduct);
    const deleteSubmissionButton=target.closest('[data-delete-submission]');
    if(deleteSubmissionButton){const submission=state.submissions.find(item=>item.id===deleteSubmissionButton.dataset.deleteSubmission);return askConfirm('删除拒绝记录',`确定永久删除“${submission?.title||'该闲置'}”的拒绝记录吗？本地上传图片也会一并清理，此操作无法恢复。`,'永久删除',()=>deleteRejectedSubmission(deleteSubmissionButton.dataset.deleteSubmission));}
    const reviewButton=target.closest('[data-review-submission]');
    if(reviewButton){const submission=state.submissions.find(item=>item.id===reviewButton.dataset.reviewSubmission);const approved=reviewButton.dataset.reviewAction==='approved';return askConfirm(approved?'审核通过并上架':'拒绝闲置发布',approved?`确定审核通过“${submission?.title||'该闲置'}”吗？通过后会生成永久商品码并立即展示在前台。`:`确定拒绝“${submission?.title||'该闲置'}”吗？该操作无法撤销。`,approved?'通过并上架':'确认拒绝',()=>reviewSubmission(reviewButton.dataset.reviewSubmission,reviewButton.dataset.reviewAction),approved);}
    const wallReview=target.closest('[data-review-wall]');
    if(wallReview){const item=state.wallPosts.find(post=>post.id===wallReview.dataset.reviewWall);const approved=wallReview.dataset.wallAction==='approved';return askConfirm(approved?'同意投稿区内容':'拒绝投稿区内容',`确定${approved?'发布':'拒绝'}“${item?.title||'该投稿'}”吗？`,approved?'同意发布':'确认拒绝',()=>reviewWallPost(wallReview.dataset.reviewWall,wallReview.dataset.wallAction),approved);}
    const wallPin=target.closest('[data-pin-wall]');
    if(wallPin){const value=wallPin.dataset.pinValue==='true';const item=state.wallPosts.find(post=>post.id===wallPin.dataset.pinWall);return askConfirm(value?'置顶投稿区内容':'取消内容置顶',`确定${value?'置顶':'取消置顶'}“${item?.title||'该投稿'}”吗？`,value?'确认置顶':'取消置顶',()=>setWallPinned(wallPin.dataset.pinWall,value),value);}
    const wallDelete=target.closest('[data-delete-wall]');
    if(wallDelete){const item=state.wallPosts.find(post=>post.id===wallDelete.dataset.deleteWall);return askConfirm('删除投稿区内容',`确定永久删除“${item?.title||'该投稿'}”吗？图片也会一并清理，此操作无法恢复。`,'永久删除',()=>deleteWallPost(wallDelete.dataset.deleteWall));}
    const handleReport=target.closest('[data-handle-wall-report]');
    if(handleReport)return askConfirm('确认处理举报','确定已核实并处理这条举报反馈吗？','标记已处理',()=>handleWallReport(handleReport.dataset.handleWallReport),true);
    const deleteReport=target.closest('[data-delete-wall-report]');
    if(deleteReport)return askConfirm('删除举报反馈','确定永久删除这条举报反馈吗？此操作无法恢复。','永久删除',()=>deleteWallReport(deleteReport.dataset.deleteWallReport));
    if(target.dataset.productStatus){const product=state.products.find(p=>p.id===target.dataset.id);const label={sold:'标记售罄',removed:'下架',available:'重新上架'}[target.dataset.productStatus];return askConfirm('确认商品操作',`确定要将“${product?.title||'该商品'}”${label}吗？`,label,()=>setProductStatus(target.dataset.id,target.dataset.productStatus),target.dataset.productStatus==='available');}
    if(target.dataset.deleteProduct){const product=state.products.find(p=>p.id===target.dataset.deleteProduct);return askConfirm('永久删除商品',`确定删除“${product?.title||'该商品'}”吗？商品数据无法恢复，但五位商品码会永久保留且永不再次使用。`,'永久删除',()=>deleteProduct(target.dataset.deleteProduct));}
    if(target.dataset.reservationStatus){const text=target.dataset.reservationStatus==='confirmed'?'确认成交将扣减一件库存。':'取消表示买家无购买意向，该记录会直接删除且无法恢复。';return askConfirm('确认处理想要记录',text,target.dataset.reservationStatus==='confirmed'?'确认成交':'取消并删除',()=>setReservationStatus(target.dataset.id,target.dataset.reservationStatus),target.dataset.reservationStatus==='confirmed');}
    if(target.dataset.deleteReservation)return askConfirm('永久删除记录','确定永久删除这条想要记录吗？此操作无法恢复。','永久删除',()=>deleteReservation(target.dataset.deleteReservation));
    if(target.dataset.saveCategory)return saveCategory(target.dataset.saveCategory);
    if(target.dataset.deleteCategory){const category=state.categories.find(c=>String(c.id)===target.dataset.deleteCategory);return askConfirm('删除分类',`确定删除“${category?.name||'该分类'}”吗？包含商品时数据库会阻止删除。`,'删除分类',()=>deleteCategory(target.dataset.deleteCategory));}
    if(target.dataset.saveHotSearch)return saveHotSearch(target.dataset.saveHotSearch);
    if(target.dataset.deleteHotSearch){const item=state.hotSearches.find(row=>String(row.id)===target.dataset.deleteHotSearch);return askConfirm('删除热搜',`确定删除热搜“${item?.keyword||''}”吗？删除后前台立即不再显示。`,'删除热搜',()=>deleteHotSearch(target.dataset.deleteHotSearch));}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('adminProductModal').classList.contains('open'))closeProductEditor();});
}

function subscribeRealtime() { if(state.channel)return;state.channel=db.channel('admin-dashboard').on('postgres_changes',{event:'*',schema:'public',table:'products'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'product_submissions'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'campus_wall_posts'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'campus_wall_reports'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'reservations'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'admin_notifications'},handleNotificationChange).on('postgres_changes',{event:'*',schema:'public',table:'categories'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'hot_searches'},refreshData).on('postgres_changes',{event:'INSERT',schema:'public',table:'site_visitors'},refreshData).subscribe(); }
function subscribePresence(){if(state.presenceChannel)return;state.presenceChannel=db.channel('site-online',{config:{presence:{key:browserClientId()}}}).on('presence',{event:'sync'},()=>{state.onlineCount=Object.keys(state.presenceChannel.presenceState()).length;if(state.view==='overview'&&!$('adminShell').hidden)renderOverview();}).subscribe(status=>{if(status==='SUBSCRIBED')state.presenceChannel.track({online_at:new Date().toISOString()});});}
function updateEditProductPriceInput(){const mode=$('editProductPriceType').value;const input=$('editProductPrice');input.disabled=false;input.required=mode!=='negotiable';input.placeholder=mode==='negotiable'?'可填写大致价格，用于价格排序':'';$('editProductPriceLabel').textContent=mode==='at_most'?'最高价格（元）':mode==='negotiable'?'大致价格（可选）':'价格（元）';}

async function init() {
  const theme=localStorage.getItem('jzsf-admin-theme')||'light';document.documentElement.dataset.theme=theme;$('adminThemeButton').textContent=theme==='dark'?'☀️':'🌙';bindEvents();
  const {data:{session}}=await db.auth.getSession(); if(await verifySession(session))await showDashboard();
  setInterval(()=>{if(state.user&&state.view==='resources'&&!document.hidden)refreshResources();},15000);
}
init().catch(error=>{$('pageLoginError').textContent=errorText(error)});
