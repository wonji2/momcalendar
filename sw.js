// 맘캘린더 PWA service worker
// 목적: '홈 화면에 추가'(앱 설치) 가능하게 하는 최소 SW.
// 주의: 이 사이트는 공구 일정이 실시간으로 바뀌므로 HTML/데이터는 캐시하지 않고
//       항상 네트워크에서 최신을 가져온다. (아이콘 등 정적 파일만 가볍게 캐시)

const CACHE = 'momcal-v2';
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
