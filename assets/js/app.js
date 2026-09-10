/* 焦大师专闲置好物平台 - 原生 JavaScript + Supabase */
const SUPABASE_URL = 'https://znrnaeebnuadbxyqaild.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__uNRNeHvjKIMfIIdhQod6Q_KVqpmE3F';

const state = {
  client: null,
  admin: null,
  categories: [],
  hotSearches: [],
  products: [],
  categoryId: 'all',
  search: '',
  minPrice: null,
  maxPrice: null,
  sort: 'newest',
  page: 1,
  pageSize: 24,
  totalProducts: 0,
  reserveProduct: null,
  adminView: 'overview',
  editingProduct: null,
  editingCategory: null,
  pendingConfirm: null,
  publicSettings: {announcement:'',hero_subtitle:'',introduction_content:'',introduction_image_url:''},
  channel: null
};

const $ = id => document.getElementById(id);
const statusText = { available:'在售', reserved:'已预定', sold:'已售出', removed:'已下架' };
const reservationText = { pending:'待处理', confirmed:'已成交', cancelled:'已取消' };

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function money(value) {
  return Number(value).toLocaleString('zh-CN',{minimumFractionDigits:Number(value)%1?2:0,maximumFractionDigits:2});
}

function friendlyError(error) {
  const message = error?.message || String(error || '操作失败');
  if (/Invalid login credentials/i.test(message)) return '管理员邮箱或密码错误';
  if (/Email not confirmed/i.test(message)) return '该管理员邮箱尚未验证';
  if (/Failed to fetch|NetworkError/i.test(message)) return '网络连接失败，请检查网络后重试';
  if (/foreign key constraint|violates foreign key/i.test(message)) return '该分类仍有商品，暂时不能删除';
  if (/duplicate key|unique constraint/i.test(message)) return '名称已存在，请换一个';
  if (/row-level security|permission denied|无权限/i.test(message)) return '无权限执行此操作';
  return message;
}

let toastTimer;
function toast(message, ok=true) {
  $('toastIcon').textContent = ok ? '✓' : '!';
  $('toastText').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3000);
}

function busy(button, loading, text='处理中…') {
  if (!button.dataset.original) button.dataset.original = button.textContent;
  button.disabled = loading;
  button.textContent = loading ? text : button.dataset.original;
}

function askConfirm(title,text,actionLabel,action,kind='danger') {
  state.pendingConfirm = action;
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmAction').textContent = actionLabel;
  $('confirmAction').className = `btn ${kind==='primary'?'btn-primary':'btn-danger'}`;
  openModal('confirmModal');
}

async function runConfirmedAction() {
  const action = state.pendingConfirm;
  state.pendingConfirm = null;
  closeModal('confirmModal');
  if (action) await action();
}

function openModal(id) {
  $(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  $(id).classList.remove('open');
  if (!document.querySelector('.modal-backdrop.open,.drawer.open')) document.body.style.overflow = '';
}

function requireBackend() {
  if (state.client) return true;
  toast('Supabase 未加载，请检查网络后刷新', false);
  return false;
}

function requireAdmin() {
  if (!requireBackend()) return false;
  if (state.admin) return true;
  openModal('adminLoginModal');
  toast('请先登录管理员后台', false);
  return false;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeButton').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('jzsf-admin-theme', theme);
}

function debounce(fn, delay=300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function productMedia(product, zoomable=false) {
  const icon = product.categories?.icon || product.category_icon || '📦';
  const image = product.image_url
    ? `<img${zoomable?' class="zoomable-image"':''} src="${escapeHtml(product.image_url)}"${zoomable?` data-full-image="${escapeHtml(product.image_url)}"`:''} alt="${escapeHtml(product.title)}" loading="lazy" onerror="this.remove()">`
    : '';
  return `${escapeHtml(icon)}${image}`;
}

async function loadCategories() {
  if (!state.client) return;
  const { data, error } = await state.client.from('categories').select('*').order('sort_order').order('id');
  if (error) throw error;
  state.categories = data || [];
  if (state.categoryId !== 'all' && !state.categories.some(c => String(c.id) === String(state.categoryId))) state.categoryId = 'all';
  renderCategories();
  fillCategorySelect();
}

async function loadHotSearches() {
  if (!state.client) return;
  const {data,error}=await state.client.from('hot_searches').select('*').eq('is_active',true).order('sort_order').order('id');
  if(error){console.warn('热搜数据尚未初始化：',error.message);state.hotSearches=[];renderHotSearches();return;}
  state.hotSearches=data||[];
  renderHotSearches();
}

function renderHotSearches() {
  $('hotSearchList').innerHTML=state.hotSearches.map(item=>{const active=state.search===item.keyword;return `<button class="hot-search-tag ${active?'active':''}" type="button" data-hot-search="${escapeHtml(item.keyword)}" aria-pressed="${active}">🔥 ${escapeHtml(item.keyword)}${active?' ×':''}</button>`;}).join('');
  $('hotSearches').hidden=!state.hotSearches.length;
}

function productsPerPage() {
  if(window.innerWidth<=760)return 12;
  if(window.innerWidth<=1020)return 18;
  return 24;
}

async function loadPublicSettings() {
  const {data,error}=await state.client.from('public_site_settings').select('*').eq('id',true).maybeSingle();
  if (error) throw error;
  state.publicSettings=data || {announcement:'',hero_subtitle:'',introduction_content:'',introduction_image_url:''};
  const announcement=state.publicSettings.announcement?.trim();
  $('heroSubtitle').textContent=state.publicSettings.hero_subtitle?.trim() || '校内二手闲置交换，教材、数码、生活好物，轻松找到下一位主人。';
  renderAnnouncement(announcement);
}

function renderAnnouncement(announcement) {
  const bar=$('announcementBar');
  const track=$('announcementText');
  track.replaceChildren();
  bar.hidden=!announcement;
  bar.classList.remove('scrolling');
  if(!announcement)return;
  const message=document.createElement('span');
  message.className='announcement-message';
  message.textContent=announcement;
  track.append(message);
  requestAnimationFrame(()=>{
    const windowEl=bar.querySelector('.announcement-window');
    if(message.scrollWidth<=windowEl.clientWidth)return;
    const duplicate=message.cloneNode(true);
    duplicate.setAttribute('aria-hidden','true');
    track.append(duplicate);
    bar.classList.add('scrolling');
  });
}

function openIntroduction() {
  const content=sanitizeIntroductionHtml(state.publicSettings.introduction_content||'');
  const imageUrl=state.publicSettings.introduction_image_url?.trim();
  if(!content.trim()&&!imageUrl)return toast('网站介绍暂未发布',false);
  $('introductionContent').innerHTML=content || '欢迎来到焦大师专闲置好物平台。';
  $('introductionImage').hidden=!imageUrl;
  if(imageUrl)$('introductionImage').src=imageUrl;
  openModal('introductionModal');
}

function sanitizeIntroductionHtml(value) {
  const template=document.createElement('template');
  template.innerHTML=String(value||'');
  const allowed=new Set(['STRONG','B','BR','DIV','P']);
  const clean=node=>{
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent||'');
    if(node.nodeType!==Node.ELEMENT_NODE)return document.createDocumentFragment();
    const fragment=document.createDocumentFragment();
    for(const child of [...node.childNodes])fragment.append(clean(child));
    if(!allowed.has(node.tagName))return fragment;
    const tag=node.tagName==='B'?'strong':node.tagName.toLowerCase();
    const element=document.createElement(tag);
    element.append(fragment);
    return element;
  };
  const output=document.createElement('div');
  for(const child of [...template.content.childNodes])output.append(clean(child));
  return output.innerHTML;
}

function renderCategories() {
  $('categoryList').innerHTML = `<button class="category-tag ${state.categoryId==='all'?'active':''}" data-category="all">全部</button>` +
    state.categories.filter(c => c.is_active || state.admin).map(c =>
      `<button class="category-tag ${String(c.id)===String(state.categoryId)?'active':''}" data-category="${c.id}">${escapeHtml(c.icon)} ${escapeHtml(c.name)}</button>`
    ).join('');
}

function fillCategorySelect() {
  $('productCategory').innerHTML = '<option value="">请选择分类</option>' + state.categories.filter(c => c.is_active).map(c =>
    `<option value="${c.id}">${escapeHtml(c.icon)} ${escapeHtml(c.name)}</option>`
  ).join('');
}

async function loadProducts() {
  if (!state.client) return;
  state.pageSize=productsPerPage();
  $('loading').classList.add('show');
  $('productGrid').innerHTML = '';
  $('emptyState').classList.remove('show');
  $('pagination').hidden=true;
  let query = state.client.from('product_feed').select('*',{count:'exact'});
  if (state.categoryId !== 'all') query = query.eq('category_id', Number(state.categoryId));
  const term = state.search.replace(/[%_,().]/g,' ').trim();
  if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%,category_name.ilike.%${term}%,campus.ilike.%${term}%`);
  if(state.minPrice!==null)query=query.gte('price',state.minPrice);
  if(state.maxPrice!==null)query=query.lte('price',state.maxPrice);
  query=query.order('is_pinned',{ascending:false});
  if(state.sort==='price_asc')query=query.order('price',{ascending:true}).order('created_at',{ascending:false});
  else if(state.sort==='price_desc')query=query.order('price',{ascending:false}).order('created_at',{ascending:false});
  else query=query.order('created_at',{ascending:false});
  const from=(state.page-1)*state.pageSize;
  const { data, error, count } = await query.range(from,from+state.pageSize-1);
  $('loading').classList.remove('show');
  if (error) {
    $('resultCount').textContent = '加载失败';
    showEmpty('!','商品加载失败',friendlyError(error));
    return;
  }
  state.totalProducts=count||0;
  const totalPages=Math.max(1,Math.ceil(state.totalProducts/state.pageSize));
  if(state.page>totalPages){state.page=totalPages;return loadProducts();}
  state.products = data || [];
  renderProducts();
  renderPagination();
}

function renderProducts() {
  $('resultCount').textContent = `共 ${state.totalProducts} 件闲置`;
  if (!state.products.length) {
    showEmpty('🔍','没有找到相关闲置','换个关键词或分类试试吧');
    return;
  }
  $('emptyState').classList.remove('show');
  $('productGrid').innerHTML = state.products.map(p => `
    <article class="product-card ${p.status==='sold'?'sold':''}" data-product-id="${p.id}" tabindex="0">
      <div class="product-media">${productMedia(p)}${p.is_pinned?'<span class="pin-badge">🔝 置顶</span>':''}<span class="status status-${p.status}">${statusText[p.status]}</span></div>
      <div class="product-body">
        <h3 class="product-title">${escapeHtml(p.title)}</h3>
        <div class="product-row"><span class="price"><small>¥</small>${money(p.price)}</span><span class="condition">${escapeHtml(p.condition)}</span></div>
        <p class="product-description">${escapeHtml(p.description || '暂无详细描述')}</p>
        <div class="product-footer"><span class="meta">${escapeHtml(p.category_icon || '📦')} ${escapeHtml(p.category_name || '其他')}</span><span class="stock-corner">剩余 ${p.available_quantity} 件</span></div>
      </div>
    </article>`).join('');
}

function renderPagination() {
  const totalPages=Math.ceil(state.totalProducts/state.pageSize);
  if(totalPages<=1){$('pagination').hidden=true;$('pagination').innerHTML='';return;}
  const pages=Array.from({length:totalPages},(_,index)=>index+1).map(page=>`<button class="page-button ${page===state.page?'active':''}" type="button" data-page="${page}" aria-label="第 ${page} 页" ${page===state.page?'aria-current="page"':''}>${page}</button>`).join('');
  $('pagination').innerHTML=`<button class="page-button" type="button" data-page="${state.page-1}" ${state.page===1?'disabled':''}>上一页</button>${pages}<button class="page-button" type="button" data-page="${state.page+1}" ${state.page===totalPages?'disabled':''}>下一页</button>`;
  $('pagination').hidden=false;
}

function showEmpty(icon,title,text) {
  $('emptyIcon').textContent = icon;
  $('emptyTitle').textContent = title;
  $('emptyText').textContent = text;
  $('emptyState').classList.add('show');
}

function searchFrom(inputId, scroll=false) {
  state.search = $(inputId).value.trim();
  state.page = 1;
  $('navSearch').value = state.search;
  $('mainSearch').value = state.search;
  renderHotSearches();
  loadProducts();
  if (scroll) document.querySelector('.main').scrollIntoView({behavior:'smooth'});
}

const liveSearch = debounce(inputId => searchFrom(inputId), 300);

const sortLabels={newest:'最新发布',price_asc:'价格从低到高',price_desc:'价格从高到低'};
function closeSortMenu() {$('sortMenu').hidden=true;$('sortToggle').setAttribute('aria-expanded','false');}
function updateSortControl() {
  $('sortLabel').textContent=sortLabels[state.sort]||sortLabels.newest;
  document.querySelectorAll('[data-sort]').forEach(button=>{const active=button.dataset.sort===state.sort;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  closeSortMenu();
}

function clearAllFilters() {
  state.categoryId='all';state.search='';state.minPrice=null;state.maxPrice=null;state.sort='newest';state.page=1;
  $('navSearch').value='';$('mainSearch').value='';$('minPrice').value='';$('maxPrice').value='';
  renderCategories();renderHotSearches();updateSortControl();loadProducts();
}

function resetHome(event) {
  event?.preventDefault();
  clearAllFilters();
  window.scrollTo({top:0,behavior:'smooth'});
}

function openReserve(product) {
  if (!product) return;
  if (product.status !== 'available') {
    toast(product.status === 'sold' ? '该商品已售罄' : '该商品暂不可购买', false);
    return;
  }
  if (!requireBackend()) return;
  state.reserveProduct = product;
  $('reserveForm').reset();
  $('reserveError').textContent = '';
  $('reserveSummary').innerHTML = `<div class="product-media">${productMedia(product,true)}</div><div class="reserve-info"><h4>${escapeHtml(product.title)}</h4><div class="price"><small>¥</small>${money(product.price)}</div><div class="detail-stock">剩余 ${product.available_quantity} 件</div></div><div class="detail-description">${escapeHtml(product.description || '暂无详细描述')}</div>`;
  $('reserveBackdrop').classList.add('open');
  $('reserveDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('buyerName').focus(),100);
}

function closeReserve() {
  $('reserveBackdrop').classList.remove('open');
  $('reserveDrawer').classList.remove('open');
  state.reserveProduct = null;
  document.body.style.overflow = '';
}

async function submitReservation(event) {
  event.preventDefault();
  if (!state.reserveProduct || !requireBackend()) return;
  const name = $('buyerName').value.trim();
  const contact = $('buyerContact').value.trim();
  const button = $('reserveSubmit');
  $('reserveError').textContent = '';
  busy(button,true,'提交中…');
  const { data, error } = await state.client.rpc('reserve_product',{
    p_product_id:state.reserveProduct.id,
    p_buyer_name:name,
    p_contact:contact,
    p_note:''
  });
  busy(button,false);
  if (error) {
    $('reserveError').textContent = friendlyError(error);
    if (/已被预定|不可购买/.test(error.message)) loadProducts();
    return;
  }
  closeReserve();
  showConnectionInfo(data || {});
  toast('想要已登记，请保存对接码');
  await loadProducts();
}

function showConnectionInfo(result) {
  $('connectionCode').textContent = result.connection_code || '获取失败';
  $('adminWechatText').textContent = result.seller_wechat || '暂未设置，请等待管理员联系';
  openModal('connectionModal');
}

function openImageLightbox(url,title='商品图片') {
  if (!url) return;
  $('zoomImage').src=url;
  $('zoomImage').alt=title;
  $('zoomImageTitle').textContent=title;
  openModal('imageLightbox');
}

async function copyConnectionCode() {
  const code = $('connectionCode').textContent;
  if (!/^\d{5}$/.test(code)) return toast('对接码暂不可复制',false);
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const field = document.createElement('textarea');
    field.value = code;
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  toast('对接码已复制');
}

async function restoreAdminSession() {
  const { data:{session} } = await state.client.auth.getSession();
  if (!session) return renderAdminState();
  const { data } = await state.client.from('profiles').select('id,nickname,is_admin').eq('id',session.user.id).maybeSingle();
  if (!data?.is_admin) {
    await state.client.auth.signOut();
    state.admin = null;
  } else {
    state.admin = { user:session.user, profile:data };
  }
  renderAdminState();
}

function renderAdminState() {
  const loggedIn = !!state.admin;
  $('adminButton').hidden = loggedIn;
  $('adminSession').hidden = !loggedIn;
  $('addProductButton').classList.toggle('show',loggedIn);
  renderCategories();
}

async function submitAdminLogin(event) {
  event.preventDefault();
  if (!requireBackend()) return;
  const button = $('adminLoginSubmit');
  $('adminLoginError').textContent = '';
  busy(button,true,'验证中…');
  try {
    const { data, error } = await state.client.auth.signInWithPassword({email:$('adminEmail').value.trim(),password:$('adminPassword').value});
    if (error) throw error;
    const profile = await state.client.from('profiles').select('id,nickname,is_admin').eq('id',data.user.id).single();
    if (profile.error) throw profile.error;
    if (!profile.data.is_admin) {
      await state.client.auth.signOut();
      throw new Error('无权限：该账号不是管理员');
    }
    state.admin = {user:data.user,profile:profile.data};
    renderAdminState();
    closeModal('adminLoginModal');
    $('adminLoginForm').reset();
    toast('管理员登录成功');
    subscribeRealtime();
    location.href = 'admin.html';
  } catch (error) {
    $('adminLoginError').textContent = friendlyError(error);
  } finally {
    busy(button,false);
  }
}

async function logoutAdmin() {
  if (!state.client) return;
  await state.client.auth.signOut();
  state.admin = null;
  $('adminSession').classList.remove('open');
  closeModal('adminPanelModal');
  renderAdminState();
  toast('已退出管理后台');
}

function openAdminPanel() {
  if (!requireAdmin()) return;
  $('adminSession').classList.remove('open');
  location.href = 'admin.html';
}

async function loadAdminView() {
  if (!state.admin) return;
  document.querySelectorAll('[data-admin-view]').forEach(button => button.classList.toggle('active',button.dataset.adminView===state.adminView));
  $('adminContent').innerHTML = '<div class="loading show">正在加载管理数据…</div>';
  if (state.adminView === 'overview') await loadAdminOverview();
  if (state.adminView === 'products') await loadAdminProducts();
  if (state.adminView === 'categories') await loadAdminCategories();
  if (state.adminView === 'reservations') await loadAdminReservations();
}

async function loadAdminOverview() {
  const [productsResult,reservationsResult,categoriesResult] = await Promise.all([
    state.client.from('products').select('id,status,quantity,sold_quantity'),
    state.client.from('reservations').select('id,status'),
    state.client.from('categories').select('id')
  ]);
  const error = productsResult.error || reservationsResult.error || categoriesResult.error;
  if (error) return renderAdminError(error);
  const products = productsResult.data || [], reservations = reservationsResult.data || [];
  const pending = reservations.filter(item=>item.status==='pending').length;
  const wanted = reservations.filter(item=>item.status!=='cancelled').length;
  const stock = products.reduce((sum,item)=>sum+item.quantity-item.sold_quantity,0);
  $('adminContent').innerHTML = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-label">全部商品</div><div class="stat-value">${products.length}</div></div>
    <div class="stat-card"><div class="stat-label">剩余库存</div><div class="stat-value">${stock}</div></div>
    <div class="stat-card"><div class="stat-label">待处理想要</div><div class="stat-value">${pending}</div></div>
    <div class="stat-card"><div class="stat-label">累计想要</div><div class="stat-value">${wanted}</div></div>
  </div><h4 class="admin-section-title">快速操作</h4><div class="admin-toolbar"><span class="hint">可在各管理页查看并处理全部详细数据。</span><button class="btn btn-primary" data-add-product>+ 发布闲置</button></div>`;
}

async function loadAdminProducts() {
  const [productsResult,reservationsResult] = await Promise.all([
    state.client.from('products').select('*,categories(id,name,icon)').order('created_at',{ascending:false}),
    state.client.from('reservations').select('product_id,status')
  ]);
  const error = productsResult.error || reservationsResult.error;
  if (error) return renderAdminError(error);
  const data = productsResult.data || [], reservations = reservationsResult.data || [];
  const wantedByProduct = reservations.reduce((map,item)=>{if(item.status!=='cancelled') map[item.product_id]=(map[item.product_id]||0)+1;return map;},{});
  $('adminContent').innerHTML = `<div class="admin-toolbar"><strong>全部商品（${data.length}）</strong><button class="btn btn-primary" data-add-product>+ 发布闲置</button></div><div class="admin-list">${data.map(p => `
    <div class="admin-item"><div class="admin-info"><div class="admin-name">${escapeHtml(p.title)} ${p.is_demo?'<span class="condition">演示</span>':''}</div><div class="admin-meta">¥${money(p.price)} · ${escapeHtml(p.categories?.name || '未分类')} · ${escapeHtml(p.campus)} · ${new Date(p.created_at).toLocaleString('zh-CN')}</div><div class="admin-detail">${escapeHtml(p.description)}<br>对接码：<strong>${escapeHtml(p.connection_code || '生成中')}</strong> · 库存：${p.quantity} 件，已售：${p.sold_quantity} 件，剩余：${p.quantity-p.sold_quantity} 件，${wantedByProduct[p.id]||0} 人想要${p.seller_contact?`<br>卖家微信：${escapeHtml(p.seller_contact)}`:''}</div></div>
    <div class="admin-actions"><span class="mini-status status-${p.status}">${statusText[p.status]}</span><button class="btn btn-small btn-ghost" data-edit-product="${p.id}">编辑</button>${p.status!=='sold'?`<button class="btn btn-small btn-primary" data-product-status="${p.id}" data-status="sold">售罄</button>`:''}${p.status!=='removed'?`<button class="btn btn-small btn-ghost" data-product-status="${p.id}" data-status="removed">下架</button>`:`<button class="btn btn-small btn-ghost" data-product-status="${p.id}" data-status="available">上架</button>`}<button class="btn btn-small btn-danger" data-delete-product="${p.id}">删除</button></div></div>`).join('') || '<div class="empty show">暂无商品</div>'}</div>`;
  state.adminProducts = data;
}

function openProductForm(product=null) {
  if (!requireAdmin()) return;
  state.editingProduct = product;
  $('productForm').reset();
  $('productError').textContent = '';
  $('productFormTitle').textContent = product ? '编辑闲置' : '发布闲置';
  $('productTitle').value = product?.title || '';
  $('productDescription').value = product?.description || '';
  $('productPrice').value = product?.price ?? '';
  $('productCondition').value = product?.condition || '';
  $('productCategory').value = product?.category_id || '';
  $('productQuantity').value = product?.quantity || 1;
  $('productQuantity').min = Math.max(1,product?.sold_quantity || 0);
  $('productSubmitContinue').hidden=!!product;
  $('sellerContact').value = product?.seller_contact || '';
  $('productImageUrl').value = '';
  $('imageHint').textContent = product?.image_url ? '当前已有图片；上传新图片或输入 URL 会替换它。本地图片会压缩至约 150KB 以内。' : '本地图片会压缩为 WebP，目标大小约 150KB 以内。';
  openModal('productModal');
}

async function compressToWebp(blob) {
  if (blob.size > 20 * 1024 * 1024) throw new Error('原图不能超过 20MB');
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const targetBytes = 150*1024;
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    let quality = .84;
    let output;
    for (let attempt=0; attempt<18; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d',{alpha:false}).drawImage(image,0,0,canvas.width,canvas.height);
      output = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',quality));
      if (!output) throw new Error('图片转换失败');
      if (output.size <= targetBytes) break;
      if (quality > .42) quality -= .07;
      else { scale *= .82; quality = .68; }
    }
    if (!output || output.size > targetBytes) throw new Error('图片过大，压缩后仍超过 150KB，请换一张图片');
    return output;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadImage(file) {
  if (!file?.type.startsWith('image/')) throw new Error('请选择图片文件');
  $('imageHint').textContent = '正在压缩为 WebP…';
  const compressed = await compressToWebp(file);
  const path = `admin/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.webp`;
  const webpFile = new File([compressed],'product.webp',{type:'image/webp'});
  const { error } = await state.client.storage.from('product-images').upload(path,webpFile,{cacheControl:'31536000',contentType:'image/webp',upsert:false});
  if (error) throw error;
  return {url:state.client.storage.from('product-images').getPublicUrl(path).data.publicUrl,path,size:compressed.size};
}

function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = '/storage/v1/object/public/product-images/';
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length));
}

async function submitProduct(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const button = event.submitter || $('productSubmit');
  const continueAdding = !state.editingProduct && button.id === 'productSubmitContinue';
  const file = $('productImage').files[0];
  const imageUrl = $('productImageUrl').value.trim();
  let uploaded = null;
  $('productError').textContent = '';
  busy(button,true,(file||imageUrl)?'处理图片中…':'保存中…');
  try {
    if (file) uploaded = await uploadImage(file);
    else if (imageUrl) {
      let parsed;
      try { parsed=new URL(imageUrl); } catch { throw new Error('图片 URL 格式不正确'); }
      if (!['http:','https:'].includes(parsed.protocol)) throw new Error('图片 URL 必须以 http 或 https 开头');
      uploaded={url:parsed.href,path:null,size:0,external:true};
    }
    const payload = {
      title:$('productTitle').value.trim(),description:$('productDescription').value.trim(),price:Number($('productPrice').value),
      condition:$('productCondition').value,campus:state.editingProduct?.campus || '焦作师专校内',category_id:Number($('productCategory').value),
      quantity:Number($('productQuantity').value),seller_contact:$('sellerContact').value.trim() || null,is_demo:false
    };
    if (uploaded?.url) payload.image_url = uploaded.url;
    const result = state.editingProduct
      ? await state.client.from('products').update(payload).eq('id',state.editingProduct.id)
      : await state.client.from('products').insert({...payload,status:'available'});
    if (result.error) throw result.error;
    if (uploaded?.url && state.editingProduct?.image_url) {
      const oldPath = storagePathFromUrl(state.editingProduct.image_url);
      if (oldPath) await state.client.storage.from('product-images').remove([oldPath]);
    }
    toast(`${state.editingProduct?'商品已更新':'发布成功'}${uploaded?.size?`，图片已压缩至 ${Math.round(uploaded.size/1024)}KB WebP`:''}`);
    if (continueAdding) {
      const category=payload.category_id,condition=payload.condition,seller=payload.seller_contact || '';
      state.editingProduct=null;
      $('productForm').reset();
      $('productCategory').value=category;
      $('productCondition').value=condition;
      $('sellerContact').value=seller;
      $('productQuantity').value=1;
      $('productQuantity').min=1;
      $('productFormTitle').textContent='继续发布闲置';
      $('imageHint').textContent='本地图片会压缩为 WebP，目标大小约 150KB 以内。';
      $('productError').textContent='';
      setTimeout(()=>$('productTitle').focus(),50);
    } else closeModal('productModal');
    await Promise.all([loadProducts(),loadAdminProducts()]);
  } catch (error) {
    if (uploaded?.path) await state.client.storage.from('product-images').remove([uploaded.path]);
    $('productError').textContent = friendlyError(error);
  } finally {
    busy(button,false);
  }
}

async function setProductStatus(id,status,button) {
  busy(button,true);
  const product = state.adminProducts?.find(item=>item.id===id);
  const payload = {status};
  if (status==='sold' && product) payload.sold_quantity = product.quantity;
  if (status==='available' && product && product.sold_quantity>=product.quantity) payload.sold_quantity = 0;
  const { error } = await state.client.from('products').update(payload).eq('id',id);
  busy(button,false);
  if (error) return toast(friendlyError(error),false);
  toast(status==='removed'?'商品已下架':status==='sold'?'商品已标记售出':'商品已恢复上架');
  await Promise.all([loadProducts(),loadAdminProducts()]);
}

function requestProductStatus(id,status,button) {
  const labels = {sold:'标记售罄',removed:'下架商品',available:'恢复上架'};
  askConfirm('请再次确认',`确定要${labels[status]}吗？此操作会立即影响前台展示。`,labels[status],()=>setProductStatus(id,status,button),status==='available'?'primary':'danger');
}

async function deleteProduct(id) {
  const product = state.adminProducts?.find(p => p.id===id);
  const { error } = await state.client.from('products').delete().eq('id',id);
  if (error) return toast(friendlyError(error),false);
  const imagePath = storagePathFromUrl(product?.image_url);
  if (imagePath) await state.client.storage.from('product-images').remove([imagePath]);
  toast('商品已删除');
  await Promise.all([loadProducts(),loadAdminProducts()]);
}

function requestDeleteProduct(id) {
  const product = state.adminProducts?.find(p => p.id===id);
  askConfirm('删除商品','确定永久删除“'+(product?.title || '该商品')+'”吗？相关想要记录也会一并删除，无法恢复。','永久删除',()=>deleteProduct(id));
}

async function loadAdminCategories() {
  const { data, error } = await state.client.from('categories').select('*').order('sort_order').order('id');
  if (error) return renderAdminError(error);
  state.categories = data;
  renderCategories();
  fillCategorySelect();
  $('adminContent').innerHTML = `<div class="admin-toolbar"><strong>分类管理（${data.length}）</strong><button class="btn btn-primary" data-add-category>+ 添加分类</button></div><div class="admin-list">${data.map(c => `
    <div class="admin-item"><div class="admin-info"><div class="admin-name">${escapeHtml(c.icon)} ${escapeHtml(c.name)}</div><div class="admin-meta">排序：${c.sort_order}</div></div><div class="admin-actions"><button class="btn btn-small btn-ghost" data-edit-category="${c.id}">编辑</button><button class="btn btn-small btn-danger" data-delete-category="${c.id}">删除</button></div></div>`).join('')}</div>`;
}

function openCategoryForm(category=null) {
  state.editingCategory = category;
  $('categoryForm').reset();
  $('categoryError').textContent = '';
  $('categoryFormTitle').textContent = category ? '编辑分类' : '添加分类';
  $('categoryIcon').value = category?.icon || '📦';
  $('categoryName').value = category?.name || '';
  $('categorySort').value = category?.sort_order ?? 0;
  openModal('categoryModal');
}

async function submitCategory(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const button = $('categorySubmit');
  const payload = {name:$('categoryName').value.trim(),icon:$('categoryIcon').value.trim(),sort_order:Number($('categorySort').value),is_active:true};
  $('categoryError').textContent = '';
  busy(button,true,'保存中…');
  const result = state.editingCategory
    ? await state.client.from('categories').update(payload).eq('id',state.editingCategory.id)
    : await state.client.from('categories').insert(payload);
  busy(button,false);
  if (result.error) return $('categoryError').textContent = friendlyError(result.error);
  closeModal('categoryModal');
  toast(state.editingCategory?'分类已更新':'分类已添加');
  await loadCategories();
  await Promise.all([loadProducts(),loadAdminCategories()]);
}

async function deleteCategory(id) {
  const category = state.categories.find(c => String(c.id)===String(id));
  const { error } = await state.client.from('categories').delete().eq('id',id);
  if (error) return toast(friendlyError(error),false);
  if (String(state.categoryId)===String(id)) state.categoryId='all';
  toast('分类已删除');
  await loadCategories();
  await Promise.all([loadProducts(),loadAdminCategories()]);
}

function requestDeleteCategory(id) {
  const category = state.categories.find(c => String(c.id)===String(id));
  askConfirm('删除分类',`确定删除分类“${category?.name || ''}”吗？仍包含商品的分类不能删除。`,'删除分类',()=>deleteCategory(id));
}

async function loadAdminReservations() {
  const { data, error } = await state.client.from('reservations').select('*,products(id,title,price,campus)').order('created_at',{ascending:false});
  if (error) return renderAdminError(error);
  state.adminReservations = data;
  $('adminContent').innerHTML = `<div class="admin-toolbar"><strong>预定记录（${data.length}）</strong></div><div class="admin-list">${data.map(r => `
    <div class="admin-item"><div class="admin-info"><div class="admin-name">${escapeHtml(r.products?.title || '商品已删除')}</div><div class="admin-meta">预定人：${escapeHtml(r.buyer_name)} · ${new Date(r.created_at).toLocaleString('zh-CN')}</div><div class="reservation-contact"><strong>联系方式：</strong>${escapeHtml(r.contact)}${r.note?`<br><strong>备注：</strong>${escapeHtml(r.note)}`:''}</div></div>
    <div class="admin-actions"><span class="mini-status status-${r.status==='pending'?'reserved':r.status==='confirmed'?'available':'sold'}">${reservationText[r.status]}</span>${r.status==='pending'?`<button class="btn btn-small btn-primary" data-reservation-status="${r.id}" data-status="confirmed">确认成交</button><button class="btn btn-small btn-ghost" data-reservation-status="${r.id}" data-status="cancelled">取消</button>`:''}<button class="btn btn-small btn-danger" data-delete-reservation="${r.id}">删除</button></div></div>`).join('') || '<div class="empty show">暂无预定记录</div>'}</div>`;
}

async function setReservationStatus(id,status,button) {
  busy(button,true);
  const { error } = await state.client.rpc('admin_set_reservation_status',{p_reservation_id:id,p_status:status});
  busy(button,false);
  if (error) return toast(friendlyError(error),false);
  toast(status==='confirmed'?'已确认成交':'预定已取消');
  await Promise.all([loadAdminReservations(),loadProducts()]);
}

function requestReservationStatus(id,status,button) {
  const text = status==='confirmed' ? '确认成交会扣减商品库存；库存为 0 时前台会显示售罄。' : '取消后该访客不再计入想要人数；若此前已成交会返还库存。';
  askConfirm('请再次确认',text,status==='confirmed'?'确认成交':'取消想要',()=>setReservationStatus(id,status,button),status==='confirmed'?'primary':'danger');
}

async function deleteReservation(id) {
  const reservation = state.adminReservations?.find(item => item.id===id);
  if (reservation?.status === 'pending') {
    const cancel = await state.client.rpc('admin_set_reservation_status',{p_reservation_id:id,p_status:'cancelled'});
    if (cancel.error) return toast(friendlyError(cancel.error),false);
  }
  const { error } = await state.client.from('reservations').delete().eq('id',id);
  if (error) return toast(friendlyError(error),false);
  toast('预定记录已删除');
  await loadAdminReservations();
}

function requestDeleteReservation(id) {
  askConfirm('删除想要记录','确定永久删除这条访客想要记录吗？此操作无法恢复。','永久删除',()=>deleteReservation(id));
}

function renderAdminError(error) {
  $('adminContent').innerHTML = `<div class="empty show"><div class="empty-icon">!</div><div class="empty-title">加载失败</div><div>${escapeHtml(friendlyError(error))}</div></div>`;
}

function subscribeRealtime() {
  if (!state.client || state.channel || !state.admin) return;
  state.channel = state.client.channel('market-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'products'},() => { loadProducts(); if(state.adminView==='products'&&$('adminPanelModal').classList.contains('open')) loadAdminProducts(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'categories'},() => { loadCategories().then(loadProducts); if(state.adminView==='categories'&&$('adminPanelModal').classList.contains('open')) loadAdminCategories(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'hot_searches'},loadHotSearches)
    .subscribe();
}

function bindEvents() {
  $('themeButton').addEventListener('click',() => applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  $('homeLink').addEventListener('click',resetHome);
  $('adminButton').addEventListener('click',() => { $('adminLoginError').textContent=''; $('adminLoginForm').reset(); openModal('adminLoginModal'); });
  $('adminChip').addEventListener('click',() => $('adminSession').classList.toggle('open'));
  $('openAdminPanel').addEventListener('click',openAdminPanel);
  $('logoutButton').addEventListener('click',logoutAdmin);
  $('adminLoginForm').addEventListener('submit',submitAdminLogin);
  $('reserveForm').addEventListener('submit',submitReservation);
  $('reserveSummary').addEventListener('click',event => {const image=event.target.closest('[data-full-image]');if(image)openImageLightbox(image.dataset.fullImage,image.alt);});
  $('copyConnectionCode').addEventListener('click',copyConnectionCode);
  $('productForm').addEventListener('submit',submitProduct);
  $('categoryForm').addEventListener('submit',submitCategory);
  $('addProductButton').addEventListener('click',() => openProductForm());
  $('closeReserve').addEventListener('click',closeReserve);
  $('cancelReserve').addEventListener('click',closeReserve);
  $('reserveBackdrop').addEventListener('click',closeReserve);
  $('confirmCancel').addEventListener('click',() => {state.pendingConfirm=null;closeModal('confirmModal');});
  $('confirmAction').addEventListener('click',runConfirmedAction);
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click',() => {if(button.dataset.close==='confirmModal') state.pendingConfirm=null;closeModal(button.dataset.close);}));
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click',event => { if(event.target===backdrop && backdrop.id!=='productModal'){if(backdrop.id==='confirmModal')state.pendingConfirm=null;closeModal(backdrop.id);} }));
  $('categoryList').addEventListener('click',event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.categoryId = button.dataset.category;
    state.page = 1;
    renderCategories();
    loadProducts();
  });
  $('hotSearchList').addEventListener('click',event=>{
    const button=event.target.closest('[data-hot-search]');
    if(!button)return;
    state.search=state.search===button.dataset.hotSearch?'':button.dataset.hotSearch;
    state.page=1;
    $('navSearch').value=state.search;
    $('mainSearch').value=state.search;
    renderHotSearches();
    loadProducts();
    document.querySelector('.main').scrollIntoView({behavior:'smooth'});
  });
  $('productGrid').addEventListener('click',event => {
    const card = event.target.closest('[data-product-id]');
    if (card) openReserve(state.products.find(p => p.id===card.dataset.productId));
  });
  $('productGrid').addEventListener('keydown',event => {
    if ((event.key==='Enter'||event.key===' ') && event.target.matches('[data-product-id]')) openReserve(state.products.find(p => p.id===event.target.dataset.productId));
  });
  ['navSearch','mainSearch'].forEach(id => {
    $(id).addEventListener('input',() => liveSearch(id));
    $(id).addEventListener('keydown',event => { if(event.key==='Enter'){event.preventDefault();searchFrom(id,id==='navSearch');} });
  });
  $('navSearchButton').addEventListener('click',() => searchFrom('navSearch',true));
  $('mainSearchButton').addEventListener('click',() => searchFrom('mainSearch'));
  $('applyPriceFilter').addEventListener('click',()=>{
    const minText=$('minPrice').value.trim(),maxText=$('maxPrice').value.trim();
    const min=minText===''?null:Number(minText),max=maxText===''?null:Number(maxText);
    if((min!==null&&(!Number.isFinite(min)||min<0))||(max!==null&&(!Number.isFinite(max)||max<0)))return toast('请输入正确的非负价格',false);
    if(min!==null&&max!==null&&min>max)return toast('最低价格不能高于最高价格',false);
    state.minPrice=min;state.maxPrice=max;state.page=1;loadProducts();
  });
  $('clearPriceFilter').addEventListener('click',clearAllFilters);
  ['minPrice','maxPrice'].forEach(id=>$(id).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('applyPriceFilter').click();}}));
  $('sortToggle').addEventListener('click',()=>{const opening=$('sortMenu').hidden;$('sortMenu').hidden=!opening;$('sortToggle').setAttribute('aria-expanded',String(opening));});
  $('sortMenu').addEventListener('click',event=>{const button=event.target.closest('[data-sort]');if(!button)return;state.sort=button.dataset.sort;state.page=1;updateSortControl();loadProducts();});
  $('pagination').addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(!button||button.disabled)return;state.page=Number(button.dataset.page);loadProducts().then(()=>document.querySelector('.section-head').scrollIntoView({behavior:'smooth',block:'start'}));});
  $('introductionButton').addEventListener('click',openIntroduction);
  document.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click',() => {state.adminView=button.dataset.adminView;loadAdminView();}));
  $('adminContent').addEventListener('click',event => {
    if (event.target.closest('[data-add-product]')) return openProductForm();
    const editProduct = event.target.closest('[data-edit-product]');
    if (editProduct) return openProductForm(state.adminProducts.find(p => p.id===editProduct.dataset.editProduct));
    const productStatus = event.target.closest('[data-product-status]');
    if (productStatus) return requestProductStatus(productStatus.dataset.productStatus,productStatus.dataset.status,productStatus);
    const deleteProductButton = event.target.closest('[data-delete-product]');
    if (deleteProductButton) return requestDeleteProduct(deleteProductButton.dataset.deleteProduct);
    if (event.target.closest('[data-add-category]')) return openCategoryForm();
    const editCategory = event.target.closest('[data-edit-category]');
    if (editCategory) return openCategoryForm(state.categories.find(c => String(c.id)===editCategory.dataset.editCategory));
    const deleteCategoryButton = event.target.closest('[data-delete-category]');
    if (deleteCategoryButton) return requestDeleteCategory(deleteCategoryButton.dataset.deleteCategory);
    const reservationStatus = event.target.closest('[data-reservation-status]');
    if (reservationStatus) return requestReservationStatus(reservationStatus.dataset.reservationStatus,reservationStatus.dataset.status,reservationStatus);
    const deleteReservationButton = event.target.closest('[data-delete-reservation]');
    if (deleteReservationButton) return requestDeleteReservation(deleteReservationButton.dataset.deleteReservation);
  });
  document.addEventListener('click',event => { if(!event.target.closest('#adminSession')) $('adminSession').classList.remove('open');if(!event.target.closest('#sortFilter'))closeSortMenu(); });
  document.addEventListener('keydown',event => { if(event.key==='Escape'){closeSortMenu();state.pendingConfirm=null;document.querySelectorAll('.modal-backdrop.open').forEach(m=>closeModal(m.id));closeReserve();} });
  let currentPageSize=productsPerPage();
  window.addEventListener('resize',debounce(()=>{const next=productsPerPage();if(next!==currentPageSize){currentPageSize=next;state.page=1;loadProducts();}},250));
}

async function init() {
  applyTheme(localStorage.getItem('jzsf-admin-theme') || 'light');
  bindEvents();
  updateSortControl();
  if (!window.supabase?.createClient) {
    $('notice').textContent = 'Supabase 客户端加载失败，请检查网络后刷新页面。';
    $('notice').classList.add('show');
    $('loading').classList.remove('show');
    showEmpty('!','服务暂时不可用','请检查网络连接后刷新页面');
    return;
  }
  state.client = window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  window.supabaseClient = state.client;
  state.client.auth.onAuthStateChange((_event,session) => {
    if (!session) { state.admin=null; renderAdminState(); }
  });
  try {
    await restoreAdminSession();
    await loadPublicSettings();
    await loadCategories();
    await loadHotSearches();
    await loadProducts();
    subscribeRealtime();
  } catch (error) {
    $('loading').classList.remove('show');
    showEmpty('!','数据库尚未初始化',friendlyError(error));
    $('notice').textContent = '请先在 Supabase SQL Editor 执行项目中的 supabase.sql。';
    $('notice').classList.add('show');
  }
}

document.addEventListener('DOMContentLoaded',init);
