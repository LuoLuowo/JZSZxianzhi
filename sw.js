const STATIC_CACHE='jzzhw-static-v7';
const IMAGE_CACHE='jzzhw-images-v1';
const STATIC_ASSETS=['/','/index.html','/admin.html','/assets/css/style.css','/assets/css/admin.css','/assets/js/app.js','/assets/js/admin.js','/assets/images/site-logo.webp','/assets/images/site-mark.webp'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(STATIC_CACHE).then(cache=>Promise.allSettled(STATIC_ASSETS.map(asset=>cache.add(asset)))).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>![STATIC_CACHE,IMAGE_CACHE].includes(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

async function trimCache(cacheName,maxEntries){
  const cache=await caches.open(cacheName);
  const keys=await cache.keys();
  if(keys.length>maxEntries)await Promise.all(keys.slice(0,keys.length-maxEntries).map(key=>cache.delete(key)));
}

async function cacheFirstImage(request){
  const cache=await caches.open(IMAGE_CACHE);
  const cached=await cache.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok||response.type==='opaque'){
    cache.put(request,response.clone()).then(()=>trimCache(IMAGE_CACHE,120)).catch(()=>{});
  }
  return response;
}

async function fastNetworkWithCache(request){
  const cache=await caches.open(STATIC_CACHE);
  const url=new URL(request.url);
  const fallbackPath=request.mode==='navigate'?(url.pathname==='/'?'/index.html':url.pathname):null;
  const cached=await cache.match(request,{ignoreSearch:true})||(fallbackPath?await cache.match(fallbackPath):null);
  const network=fetch(request).then(response=>{
    if(response.ok)cache.put(request,response.clone()).catch(()=>{});
    return response;
  }).catch(error=>{if(cached)return cached;throw error;});
  if(!cached)return network;
  return Promise.race([network,new Promise(resolve=>setTimeout(()=>resolve(cached),1200))]);
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  const isSupabaseImage=url.hostname==='znrnaeebnuadbxyqaild.supabase.co'&&url.pathname.includes('/storage/v1/object/public/product-images/');
  const isLocalImage=url.origin===self.location.origin&&request.destination==='image';
  if(isSupabaseImage||isLocalImage){event.respondWith(cacheFirstImage(request));return;}
  if(request.mode==='navigate'){event.respondWith(fastNetworkWithCache(request));return;}
  if(url.origin===self.location.origin&&['style','script'].includes(request.destination))event.respondWith(fastNetworkWithCache(request));
});
