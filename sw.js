/* ══════════════════════════════════════════════════════════════
   「可能性空间」Service Worker（v1.5）
   存在的唯一理由：让「她」能走出软件——把她说的话以系统通知送到你手上。
   顺带把 index.html 缓存一份，断网也能打开。

   用法：和 index.html、manifest.json 放在同一个目录，一起上传到 GitHub Pages。
   （在电脑上直接双击 index.html 打开时不会用到它——file:// 用不了通知，
     浏览器会自动跳过，功能整体降级，不会报错。）
   ══════════════════════════════════════════════════════════════ */

const CACHE = 'ps-v1.7.6';
/* 系统默认的她（v1.6.1）：普通与 Q版两张最关键的先预缓存，其余表情差分随抓随存
   ⚠️ v1.7.6 起这两张是 .webp（上传的那份 mimi/ 全是压过的 .webp，PNG 原图在家里的「原图备份/」）。
      以后你要是把 mimi/ 里的图换成别的格式，这里两条也要跟着改 —— 改错了不影响使用
      （下面 addAll 有 catch，装不上就跳过），只是那两张失去了「断网也能开」的待遇 */
const SHELL = ['./', './index.html', './manifest.json', './apple-touch-icon.png', './favicon.png', './mimi/normal.webp', './mimi/q.webp'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(SHELL); })
      .catch(function(){})          // 有个别文件不在也不影响安装
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

/* 网络优先、失败回落缓存：改了 index.html 一刷新就能看到，断网时照样能打开 */
self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;
  let same = false;
  try{ same = new URL(req.url).origin === self.location.origin; }catch(err){ same = false; }
  if(!same) return;
  e.respondWith(
    fetch(req).then(function(res){
      const copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
      return res;
    }).catch(function(){
      return caches.match(req).then(function(r){ return r || caches.match('./index.html'); });
    })
  );
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
