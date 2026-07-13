const DB_NAME = 'noveltrans-db';
const DB_VERSION = 1;

/**
 * IndexedDB 데이터베이스를 열고 초기 스키마를 구성합니다.
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (e) => reject('Failed to open database: ' + e.target.error);
    request.onsuccess = (e) => resolve(e.target.result);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 1. 소설 메타데이터 테이블 (novels)
      if (!db.objectStoreNames.contains('novels')) {
        db.createObjectStore('novels', { keyPath: 'id', autoIncrement: true });
      }

      // 2. 에피소드 번역 캐시 테이블 (episodes)
      if (!db.objectStoreNames.contains('episodes')) {
        const episodeStore = db.createObjectStore('episodes', { keyPath: 'id' }); // key: novelId_chapter 형식
        episodeStore.createIndex('novelId', 'novelId', { unique: false });
        episodeStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
}

/**
 * 소설 보관함에 새 소설을 추가하거나 정보를 업데이트합니다.
 */
export async function saveNovel(novel) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['novels'], 'readwrite');
    const store = transaction.objectStore('novels');
    const request = store.put(novel); // key가 있으면 수정, 없으면 삽입

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject('Failed to save novel: ' + e.target.error);
  });
}

/**
 * 저장된 모든 소설 목록을 가져옵니다.
 */
export async function getNovels() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['novels'], 'readonly');
    const store = transaction.objectStore('novels');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject('Failed to get novels: ' + e.target.error);
  });
}

/**
 * 특정 소설을 보관함에서 지우고, 관련 에피소드 캐시도 모두 날립니다 (캐시 삭제 기능).
 */
export async function deleteNovel(novelId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['novels', 'episodes'], 'readwrite');
    
    // 1. 소설 메타 삭제
    const novelStore = transaction.objectStore('novels');
    novelStore.delete(novelId);

    // 2. 해당 소설의 모든 에피소드 캐시 일괄 삭제
    const episodeStore = transaction.objectStore('episodes');
    const index = episodeStore.index('novelId');
    const request = index.openCursor(IDBKeyRange.only(novelId));

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = (e) => reject('Failed to delete novel data: ' + e.target.error);
  });
}

/**
 * 특정 화수(에피소드)의 번역본 및 원본 텍스트를 로컬 캐시에 저장합니다.
 */
export async function saveEpisode(novelId, chapter, translatedText, originalText) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['episodes'], 'readwrite');
    const store = transaction.objectStore('episodes');
    
    const episodeData = {
      id: `${novelId}_${chapter}`, // 고유 키
      novelId: novelId,
      chapter: parseInt(chapter),
      translatedText: translatedText,
      originalText: originalText,
      updatedAt: Date.now() // 최신 읽은 시간 기록 (LRU 캐시 정리용)
    };

    const request = store.put(episodeData);

    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject('Failed to save episode cache: ' + e.target.error);
  });
}

/**
 * 특정 화수의 번역본 캐시를 가져옵니다.
 */
export async function getEpisode(novelId, chapter) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['episodes'], 'readonly');
    const store = transaction.objectStore('episodes');
    const request = store.get(`${novelId}_${chapter}`);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject('Failed to get episode cache: ' + e.target.error);
  });
}

/**
 * 캐시 정리 기능: 특정 소설의 특정 화수들만 선택하여 캐시를 지웁니다.
 */
export async function deleteEpisodes(novelId, chapters) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['episodes'], 'readwrite');
    const store = transaction.objectStore('episodes');

    chapters.forEach(chapter => {
      store.delete(`${novelId}_${chapter}`);
    });

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = (e) => reject('Failed to delete chapters: ' + e.target.error);
  });
}

/**
 * 오래된 캐시 일괄 삭제 기능: 최근 N일 동안 읽지 않은 소설 에피소드 캐시를 지웁니다.
 */
export async function clearOldEpisodes(daysLimit) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['episodes'], 'readwrite');
    const store = transaction.objectStore('episodes');
    const index = store.index('updatedAt');
    
    const timeLimit = Date.now() - (daysLimit * 24 * 60 * 60 * 1000);
    const range = IDBKeyRange.upperBound(timeLimit);
    const request = index.openCursor(range);

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete(); // 시간 기준 초과한 캐시 소거
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = (e) => reject('Failed to clear old episodes: ' + e.target.error);
  });
}

/**
 * 캐시 통계 반환 기능: 저장된 소설 정보와 총 에피소드 수량을 계산합니다.
 */
export async function getCacheStatistics() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['novels', 'episodes'], 'readonly');
    
    const novelsStore = transaction.objectStore('novels');
    const episodesStore = transaction.objectStore('episodes');
    
    const novelsCountReq = novelsStore.count();
    const episodesCountReq = episodesStore.count();

    transaction.oncomplete = () => {
      resolve({
        totalNovels: novelsCountReq.result,
        totalCachedEpisodes: episodesCountReq.result
      });
    };
    
    transaction.onerror = (e) => reject('Failed to fetch cache stats: ' + e.target.error);
  });
}

/**
 * 보관함 및 에피소드 캐시 전체 데이터를 백업용 Base64 문자열로 추출합니다.
 */
export async function exportAllData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['novels', 'episodes'], 'readonly');
    const novelsStore = transaction.objectStore('novels');
    const episodesStore = transaction.objectStore('episodes');

    const novelsReq = novelsStore.getAll();
    const episodesReq = episodesStore.getAll();

    transaction.oncomplete = () => {
      const backupData = {
        novels: novelsReq.result,
        episodes: episodesReq.result,
        exportedAt: Date.now()
      };
      const jsonStr = JSON.stringify(backupData);
      const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
      resolve(base64Str);
    };

    transaction.onerror = (e) => reject('Failed to export data: ' + e.target.error);
  });
}

/**
 * 백업용 Base64 텍스트를 복원하여 로컬 IndexedDB에 적재합니다.
 */
export async function importAllData(base64Str) {
  const db = await openDB();
  const jsonStr = decodeURIComponent(escape(atob(base64Str.trim())));
  const backupData = JSON.parse(jsonStr);

  if (!backupData || !backupData.novels || !backupData.episodes) {
    throw new Error('올바르지 않은 백업 데이터 형식입니다.');
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['novels', 'episodes'], 'readwrite');
    const novelsStore = transaction.objectStore('novels');
    const episodesStore = transaction.objectStore('episodes');

    backupData.novels.forEach(novel => {
      novelsStore.put(novel);
    });

    backupData.episodes.forEach(episode => {
      episodesStore.put(episode);
    });

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = (e) => reject('데이터 복원에 실패했습니다: ' + e.target.error);
  });
}

