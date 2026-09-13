/* ══════════════════════════════════════════════════════════════
   「可能性空间」Service Worker（v1.5 起；v1.7.8 改成「本地优先」）

   存在的理由有两个：
   ① 让「她」能走出软件——把她说的话以系统通知送到你手上
   ② 让软件**打开就是秒开**：图和页面存一次就留在手机本地，之后不再联网

   ⚠️ v1.7.8 为什么改（2026-09-12 用户报「网址加载不出来，非常慢」）：
     老版本这里是「网络优先」——每次打开，**每一个请求都先去问一遍服务器**，
     连本地已经存过的图也不例外。而软件开机要探几百个地址（v1.7.7 起每张图找
     12 个位置），github.io 在国内又慢又易断 → 每次打开都要等几分钟。
     现在改成：**什么都走本地优先**——图和页面存过就直接给、一次网络都不发；
     页面在后台悄悄重拿一份（下次打开就是新的）。所以第一次打开联网存一遍，
     之后每次都是 0 等待，断网也能用。

   用法：和 index.html、manifest.json 放在同一个目录，一起上传到 GitHub Pages。
   （在电脑上直接双击 index.html 打开时不会用到它——file:// 用不了，
     浏览器会自动跳过，功能整体降级，不会报错。）
   ══════════════════════════════════════════════════════════════ */

/* ⚠️ 改版本就改这个缓存名：一改名字，旧缓存会在下次打开时整个丢掉重来一次
   （所以「我发了新版」和「你换了图」这两件事都是靠它刷新的） */
const CACHE = 'ps-v1.7.9';

/* 装机时先存下来的那几样（图不用列在这儿——软件开机自己会把要用的图探一遍，
   探到什么就存什么，见下面 fetch 里的本地优先逻辑）。
   这几条里有一条不在也不影响安装，只是少一份「断网也能开」的保障 */
const SHELL = ['./', './index.html', './manifest.json', './apple-touch-icon.png', './favicon.png'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* ⚠️ 一条一条 add 各自 catch，**不要用 addAll**：
         addAll 是「有一个失败就整批失败」，catch 一吞等于什么都没存下 */
      return Promise.all(SHELL.map(function(u){ return c.add(u).catch(function(){}); }));
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
                             .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function isHTML(req){
  try{
    if(req.mode === 'navigate') return true;
    return String(req.headers.get('accept') || '').indexOf('text/html') >= 0;
  }catch(e){ return false; }
}

/* ── 页面（HTML）───────────────────────────────────────────────
   ⚠️ 这里**不能**写「先等网络、超时再回落」：哪怕只等 1 秒，也是每次打开都先白等 1 秒，
      那就不是秒开了。所以走「本地那份立刻给，网络在后台悄悄更新」——
      打开是 0 等待的，而**下一次**打开拿到的是新的。

   这样「我发了新版你能看到吗」？能，而且是第一次打开就见到——因为**每次发版我都会换
   CACHE 的名字**（上一版 ps-v1.7.8 → 这一版 ps-v1.7.9），旧缓存整批作废、本地那份
   也没了，于是第一次打开走的正是下面这条「本地没有 → 等网络」。
   后台更新只用来兜住「改了文件但没换缓存名」这种情况。 */
async function serveHTML(req){                 // 给页面用：本地优先，本地没有才等网络
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if(cached) return cached;
  try{
    const res = await fetch(req);
    if(res && res.ok) cache.put(req, res.clone()).catch(function(){});
    return res;
  }catch(err){ return Response.error(); }
}
async function revalidate(req){                // 后台更新：每次打开顺手重拿一份存下（不发新版就是个 304，几乎不花流量）
  const cache = await caches.open(CACHE);
  try{
    const res = await fetch(req);
    /* ⚠️ 只认 res.ok：没改动时服务器回 304，那不是 2xx，存进去反而会把好好的页面弄坏 */
    if(res && res.ok) await cache.put(req, res.clone());
  }catch(err){}
}

/* 图和其它静态文件：本地优先——存过就直接给，**完全不联网**。
   ⚠️ 404 也要存下来（「这个位置没有图」也是一个答案）——
      不存的话，开机那几百次探测每次都要真的去问一遍服务器，秒开就没了 */
async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  try{
    const res = await fetch(req);
    if(res && (res.ok || res.status === 404)) cache.put(req, res.clone()).catch(function(){});
    return res;
  }catch(err){
    return Response.error();     // 让 <img> 的图裂接力照常往下走
  }
}

self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;
  let same = false;
  try{ same = new URL(req.url).origin === self.location.origin; }catch(err){ same = false; }
  if(!same) return;
  if(isHTML(req)){
    /* ⚠️ waitUntil / respondWith 都必须在事件派发的这一拍里叫，不能藏在 await 后面——
       不然浏览器认为这个事件已经结束了，后台那次更新会被中途掐掉 */
    e.waitUntil(revalidate(req));
    e.respondWith(serveHTML(req));
    return;
  }
  e.respondWith(cacheFirst(req));
});

/* ── v1.7.8：「刷新她的图」──
   她在设置里点了那个按钮，页面把「每个名字该按什么顺序试」发过来（见 index.html 的 Notify.refreshArt），
   这里替它一个个去问服务器：**按顺序试，试到第一个有的就停**（顺序就是 PNG 优先那条红线，
   所以新画的 PNG 一定赢过旧的 .webp），试过的 404 也存下来（下次开机就不用再问了）。
   放在 sw 里做是因为只有这里能「绕开缓存」真的去问服务器（fetch 带 cache:'reload'）。 */
async function refreshOne(cache, cands){
  for(const u of (cands || [])){
    try{
      const res = await fetch(u, {cache:'reload'});
      if(!res) continue;
      if(res.ok){ await cache.put(u, res.clone()); return 1; }
      if(res.status === 404) await cache.put(u, res.clone());
    }catch(err){ /* 断了就跳过这个位置 */ }
  }
  return 0;
}

self.addEventListener('message', function(e){
  const d = e.data || {};
  if(d.type !== 'ps-refresh') return;
  const reply = function(msg){
    try{
      if(e.ports && e.ports[0]) e.ports[0].postMessage(msg);
      else if(e.source && e.source.postMessage) e.source.postMessage(msg);
    }catch(err){}
  };
  e.waitUntil((async function(){
    const cache = await caches.open(CACHE);
    const names = d.names || [];
    let found = 0;
    /* 一个名字一条链（各自按顺序试、试到就停）；名字之间并行，太快也不会卡住谁 */
    const got = await Promise.all(names.map(function(n){
      return refreshOne(cache, n.cands).catch(function(){ return 0; });
    }));
    got.forEach(function(v){ found += v; });
    reply({type:'ps-refresh-done', names:found, total:names.length});
  })());
});

/* 点通知 → 把软件叫到前台（已经开着就切过去，没开就打开） */
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
      for(let i=0;i<list.length;i++){ if(list[i].focus) return list[i].focus(); }
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
