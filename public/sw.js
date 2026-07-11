const CACHE_NAME = 'noveltrans-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json'
];

// 서비스 워커 설치 시 정적 자원 캐싱
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching essential assets...');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 활성화 시 오래된 캐시 정리
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 네트워크 요청 가로채기 (오프라인 작동 보장)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 로컬 API 요청(/api/proxy)은 캐싱에서 제외하고 항상 실시간 네트워크 요청을 수행
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // 일반 정적 파일들은 Cache-First 후 Network Fallback 정책 적용
  event.respondWith(
    caches.match(req).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(req).then(networkResponse => {
        // 유효한 네트워크 응답이 오면 캐시에 동적으로 추가
        if (networkResponse && networkResponse.status === 200 && req.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // 네트워크 실패 및 캐시 부재 시 폴백 처리 (예: index.html 반환)
        if (req.headers.get('accept').includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
