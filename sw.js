// 맘캘린더 PWA service worker
// 목적: '홈 화면에 추가'(앱 설치) + 찜 공구 푸시 알림 수신.
// 주의: 이 사이트는 공구 일정이 실시간으로 바뀌므로 HTML/데이터는 캐시하지 않고
//       항상 네트워크에서 최신을 가져온다. (아이콘 등 정적 파일만 가볍게 캐시)

const CACHE = 'momcal-v3';
const ASSETS = [
  '/momcal-appicon.png',
  '/manifest.json'
];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(ASSETS).catch(function(){}); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  const url = e.request.url;
  // 아이콘/매니페스트만 캐시 우선, 나머지(HTML·API·데이터)는 항상 네트워크
  if (ASSETS.some(function(a){ return url.indexOf(a) !== -1; })) {
    e.respondWith(
      caches.match(e.request).then(function(r){ return r || fetch(e.request); })
    );
  }
  // 그 외에는 기본 동작(네트워크) 그대로 → 실시간 데이터 보장
});


// ══════════════════════════════════════════════════════════
//  푸시 알림 (찜한 공구 오픈·마감 알림)
// ══════════════════════════════════════════════════════════

self.addEventListener('push', function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch(_) {
    try { d = { body: e.data.text() }; } catch(__) { d = {}; }
  }

  var title = d.title || '맘캘린더';
  var opts = {
    body:  d.body  || '찜한 공구 소식이 있어요',
    icon:  d.icon  || '/momcal-appicon.png',
    badge: '/momcal-appicon.png',
    tag:   d.tag   || 'momcal',       // 같은 tag면 알림이 쌓이지 않고 교체됨
    renotify: true,
    data:  { url: d.url || '/' },
    requireInteraction: false
  };

  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/';

  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list){
      // 이미 열린 맘캘린더 창이 있으면 그 창을 살려서 이동 (앱 중복 실행 방지)
      for (var i=0; i<list.length; i++){
        var c = list[i];
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c){
          if ('navigate' in c && target !== '/') { try { c.navigate(target); } catch(_){} }
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

// 구독이 만료·교체되면 브라우저가 알려줌 → 페이지가 열릴 때 재등록되도록 표시만 남김
self.addEventListener('pushsubscriptionchange', function(e){
  e.waitUntil(
    self.registration.showNotification('맘캘린더 알림 설정', {
      body: '알림 설정을 다시 확인해 주세요',
      icon: '/momcal-appicon.png',
      tag: 'momcal-resub',
      data: { url: '/' }
    })
  );
});
