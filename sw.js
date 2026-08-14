const CACHE = 'jhc-fleet-command-v22-reminder';
const ASSETS = ['./', './index.html', './book-format.js', './manifest.json', './firebase-config.js', './icon-192.png', './icon-512.png', './logo-h.png', './fleet-login-bg.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패 시 캐시 (항상 최신 버전 우선)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', event => {
  let payload={};
  try{ payload=event.data?event.data.json():{}; }catch(error){ payload={notification:{body:event.data?.text()||''}}; }
  const data=payload.data||{},notification=payload.notification||{};
  const title=notification.title||data.title||'운행 종료 확인이 필요합니다';
  event.waitUntil(self.registration.showNotification(title,{
    body:notification.body||data.body||'종료 KM을 입력하거나 계속 운행 중을 선택해 주세요.',
    icon:'./icon-192.png',badge:'./icon-192.png',tag:`trip-reminder-${data.tripId||'open'}`,
    renotify:true,requireInteraction:true,vibrate:[180,100,180],data,
    actions:[{action:'finish',title:'운행 종료'},{action:'continue',title:'계속 운행 중'}]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data=event.notification.data||{},choice=event.action==='continue'?'continue':'finish',target=new URL('./',self.location.href);
  if(data.tripId) target.searchParams.set('tripReminder',data.tripId);
  target.searchParams.set('choice',choice);
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const same=list.find(client=>new URL(client.url).origin===target.origin);
    if(same){same.navigate(target.href);return same.focus();}
    return clients.openWindow(target.href);
  }));
});
