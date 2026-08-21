const CACHE = 'jhc-fleet-command-v24-simple-push-setup';
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

// 네트워크 우선, 실패 시 캐시 (항상 최신 버전 우선
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
    const kind=data.kind||'end';
    const title=notification.title||data.title||(kind==='start'?'운행 시작 확인이 필요합니다':kind==='weekly'?'주간 운행기록 점검 결과':'운행 종료 확인이 필요합니다');
    const bodyFallback=kind==='start'?'시작 버튼을 눌러 출발 KM을 기록해 주세요.':kind==='weekly'?'지난주 운행기록 점검 결과를 확인해 주세요.':'종료 KM을 입력하거나 계속 운행 중을 선택해 주세요.';
    const actions=kind==='start'
      ? [{action:'start',title:'운행 시작'},{action:'later',title:'잠시 후'},{action:'holiday',title:'금일 휴일'}]
          : kind==='weekly'
        ? [{action:'view',title:'확인'}]
            : [{action:'finish',title:'운행 종료'},{action:'continue',title:'계속 운행 중'}];
    event.waitUntil(self.registration.showNotification(title,{
          body:notification.body||data.body||bodyFallback,
          icon:'./icon-192.png',badge:'./icon-192.png',tag:`${kind}-reminder-${data.tripId||data.date||data.weekFrom||'open'}`,
          renotify:true,requireInteraction:kind!=='weekly',vibrate:[180,100,180],data:Object.assign({kind},data),
          actions
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const data=event.notification.data||{},kind=data.kind||'end',target=new URL('./',self.location.href);
    if(kind==='start'){
          const choice=event.action==='holiday'?'holiday':event.action==='later'?'later':'start';
          target.searchParams.set('startReminder','1');
          target.searchParams.set('choice',choice);
    }else if(kind==='weekly'){
          target.searchParams.set('weeklyReminder','1');
    }else{
          const choice=event.action==='continue'?'continue':'finish';
          if(data.tripId) target.searchParams.set('tripReminder',data.tripId);
          target.searchParams.set('choice',choice);
    }
    event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
          const same=list.find(client=>new URL(client.url).origin===target.origin);
          if(same){same.navigate(target.href);return same.focus();}
          return clients.openWindow(target.href);
    }));
});
