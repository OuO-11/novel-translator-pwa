import { openDB } from './db.js';

/**
 * IndexedDB에 캐싱되어 있는 특정 소설의 에피소드들을 읽어와서 
 * 단일 텍스트 파일(.txt)로 병합 후 브라우저 다운로드를 실행합니다.
 * @param {number} novelId 소설 고유 ID
 * @param {string} novelTitle 소설 제목
 * @param {string} site 출처 사이트명
 */
export async function downloadCachedEpisodes(novelId, novelTitle, site) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['episodes'], 'readonly');
    const store = transaction.objectStore('episodes');
    const index = store.index('novelId');
    const request = index.getAll(IDBKeyRange.only(novelId));

    request.onsuccess = () => {
      const episodes = request.result;

      if (!episodes || episodes.length === 0) {
        return reject(new Error('다운로드할 수 있는 캐시된 화수가 없습니다. 먼저 소설을 읽어 번역 캐시를 적재해 주세요.'));
      }

      // 1. 화수(chapter) 기준 오름차순 정렬
      episodes.sort((a, b) => a.chapter - b.chapter);

      // 2. 텍스트 병합 및 포맷 구성
      let mergedText = `==================================================\n`;
      mergedText += ` 소설 제목: ${novelTitle}\n`;
      mergedText += ` 출처 사이트: ${site}\n`;
      mergedText += ` 다운로드 화수: ${episodes[0].chapter}화 ~ ${episodes[episodes.length - 1].chapter}화 (총 ${episodes.length}개 에피소드)\n`;
      mergedText += ` 생성 일자: ${new Date().toLocaleString()}\n`;
      mergedText += `==================================================\n\n`;

      episodes.forEach(ep => {
        mergedText += `[제 ${ep.chapter}화]\n\n`;
        mergedText += `--- [한글 번역본] ---\n`;
        mergedText += `${ep.translatedText}\n\n`;
        
        // 원문 대조용 데이터가 존재하는 경우 함께 기입
        if (ep.originalText) {
          mergedText += `--- [원본 대조] ---\n`;
          mergedText += `${ep.originalText}\n\n`;
        }
        
        mergedText += `\n==================================================\n\n`;
      });

      // 3. Blob 객체를 생성하여 파일 다운로드 트리거
      try {
        const blob = new Blob([mergedText], { type: 'text/plain;charset=utf-8' });
        const fileUrl = URL.createObjectURL(blob);
        
        // 파일명 세팅 예시: [52shuku] 소설제목_1화_to_50화.txt
        const startEp = episodes[0].chapter;
        const endEp = episodes[episodes.length - 1].chapter;
        const safeTitle = novelTitle.replace(/[\/\\?%*:|"<>\s]/g, '_'); // 파일명 금지문자 치환
        const fileName = `[${site}] ${safeTitle}_${startEp}화_to_${endEp}화.txt`;

        const tempLink = document.createElement('a');
        tempLink.href = fileUrl;
        tempLink.download = fileName;
        document.body.appendChild(tempLink);
        tempLink.click();
        
        // 클릭 완료 후 리소스 해제
        document.body.removeChild(tempLink);
        URL.revokeObjectURL(fileUrl);
        
        resolve(fileName);
      } catch (err) {
        reject(new Error('파일 생성 중 에러가 발생했습니다: ' + err.message));
      }
    };

    request.onerror = (e) => {
      reject(new Error('데이터베이스 조회 실패: ' + e.target.error));
    };
  });
}
