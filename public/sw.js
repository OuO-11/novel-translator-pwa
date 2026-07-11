const CACHE_NAME = 'noveltrans-v2';
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

// 네트워크 요청 가로채기 (PWA 고질병인 캐시 고착을 해결하기 위해 Network-First 전략 적용)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 로컬 API 요청(/api/proxy)은 캐싱에서 제외하고 항상 실시간 네트워크 요청을 수행
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-First 정책 적용:
  // 온라인 상태라면 언제나 Vercel 원격 서버에서 최신 코드 에셋을 즉시 로드하여 업데이트를 실시간 반영합니다.
  // 인터넷 단절(비행기 모드, 터널 등 오프라인) 상태에 빠진 경우에만 로컬 캐시에 저장된 정적 파일을 꺼내 서빙합니다.
  event.respondWith(
    fetch(req)
      .then(networkResponse => {
        // 네트워크 응답 성공 시 캐시에 동적으로 보관 처리하여 최신 버전 동기화
        if (networkResponse && networkResponse.status === 200 && req.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // 네트워크 요청이 실패(오프라인)한 경우 로컬 캐시에서 자원을 꺼내 서빙
        return caches.match(req).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // 캐시에도 없다면 메인 index.html로 유도
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html');
          }
        });
      })
  );
});
