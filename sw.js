/* 加到主畫面後的快取(network-first):有網路一律拿最新的網頁、預測與傷兵資料,只有斷線時才用上次存的版本,
   所以不會看到舊預測;ESPN 等外部資料不經過這裡。 */
const CACHE='nba-v1';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./manifest.json','./icon-192.png'])).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==CACHE)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;const u=new URL(req.url);if(u.origin!==location.origin)return;
  if(/\/seed\/ledger-|\/seed\/pbp-|\.gz$/.test(u.pathname))return;   /* 大型歷史檔不快取 */
  e.respondWith((async()=>{
    try{const res=await fetch(req,{cache:'no-store'});
      if(res.ok){const c=await caches.open(CACHE);const key=new Request(u.origin+u.pathname);c.put(key,res.clone()).catch(()=>{});}
      return res;}
    catch(err){const c=await caches.open(CACHE);const hit=await c.match(new Request(u.origin+u.pathname))||(req.mode==='navigate'?await c.match('./index.html')||await c.match('./'):null);
      if(hit)return hit;throw err;}
  })());
});
