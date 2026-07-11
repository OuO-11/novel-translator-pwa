import { translateTextWithRotation } from './apiRotator.js';

/**
 * 1. 목록 번역 (Full Web Page Mode)
 * 원본 HTML 스트링을 받아, 레이아웃(태그 구조)은 100% 유지한 채 
 * 텍스트가 들어있는 노드들만 찾아내 실시간으로 번역하여 주입한 뒤 완성된 HTML을 반환합니다.
 * @param {string} rawHtml 원본 HTML 소스
 * @param {string} systemPrompt 적용할 소설/목록 번역 프롬프트
 * @param {string} model 사용할 Gemini 모델
 * @param {function} onProgress 진행률 업데이트 콜백 (0 ~ 100)
 */
export async function translateFullPage(rawHtml, systemPrompt, model, onProgress = () => {}) {
  // 브라우저의 DOMParser를 이용해 가상 DOM 트리 생성 (CORS에 안전함)
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 번역이 필요 없는 태그 목록 (스크립트, 스타일, 메타 태그 등)
  const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE'];

  const textNodes = [];

  // DOM 트리를 재귀적으로 순회하며 번역할 텍스트 노드 수집
  function walk(node) {
    if (node.nodeType === Node.ELEMENT_NODE && EXCLUDE_TAGS.includes(node.tagName)) {
      return;
    }
    // 텍스트 노드이고 공백이 아닌 실제 문자가 들어있는 경우만 수집
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.trim();
      if (text.length > 0 && isNaN(text)) { // 순수 숫자 제외
        textNodes.push(node);
      }
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  walk(doc.body || doc);

  const totalNodes = textNodes.length;
  if (totalNodes === 0) return rawHtml;

  console.log(`[Full Page Translator] Found ${totalNodes} text nodes to translate.`);

  // API 호출 최적화: 텍스트 노드들을 묶어 번들링(Batching)하여 요청
  // 텍스트 노드 하나씩 API를 날리면 한도에 걸리므로, 15~20개씩 묶어서 하나의 단락으로 보냄
  const BATCH_SIZE = 15;
  let translatedCount = 0;

  for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
    const batch = textNodes.slice(i, i + BATCH_SIZE);
    
    // 번들 구조화: 번역기가 노드 순서를 매핑할 수 있도록 임의의 구분자(ID) 주입
    // 예: [1] 원문텍스트1\n[2] 원문텍스트2...
    const batchText = batch.map((node, index) => `[${index}] ${node.nodeValue.trim()}`).join('\n');

    // 배치별 전용 번역 프롬프트
    const batchPrompt = `${systemPrompt}\n\nIMPORTANT: You must translate each line marked with '[number]' in order. Maintain the format '[number] Translated text'. Do not merge lines or omit numbers.`;

    try {
      const translatedBatch = await translateTextWithRotation(batchText, batchPrompt, model);
      
      // 번역 결과 파싱하여 원래 노드에 주입
      const lines = translatedBatch.split('\n');
      const translationMap = {};

      lines.forEach(line => {
        const match = line.match(/^\[(\d+)\]\s*(.*)/);
        if (match) {
          const index = parseInt(match[1]);
          const translatedVal = match[2].trim();
          translationMap[index] = translatedVal;
        }
      });

      // 맵 데이터를 바탕으로 DOM 노드 값 교체
      batch.forEach((node, index) => {
        if (translationMap[index]) {
          node.nodeValue = translationMap[index];
        }
      });

    } catch (e) {
      console.error(`[Batch Translation Failed] Index ${i} to ${i + BATCH_SIZE}:`, e);
      // 실패 시 원래 원문 뒤에 경고 표시만 추가하여 전체 번역이 멈추는 것 방지
      batch.forEach(node => {
        node.nodeValue = `${node.nodeValue} (번역 실패)`;
      });
    }

    translatedCount += batch.length;
    onProgress(Math.min(Math.round((translatedCount / totalNodes) * 100), 100));
  }

  // 수정된 DOM을 다시 HTML 스트링으로 변환하여 반환
  return doc.documentElement.outerHTML;
}

/**
 * 2. 소설 본문 가독성 리더기 파싱 (Reader Mode Text Extractor)
 * 원본 HTML 소스에서 본문 텍스트만 깔끔하게 추출합니다. (광고 및 쓰레기 태그 차단)
 * @param {string} rawHtml 원본 HTML 소스
 * @param {string} url 해당 소설의 원본 주소 (도메인별 특화 파싱용)
 */
export function extractNovelContent(rawHtml, url) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  
  let title = doc.querySelector('title')?.textContent?.trim() || '제목 없음';
  let contentHtml = '';

  // 도메인별 소설 본문 영역 파싱 규칙 커스텀 (52shuku, 진강문학성 등)
  if (url.includes('52shuku')) {
    // 52shuku는 대개 <article class="article-content"> 또는 <div class="article-content"> 내에 본문이 존재함
    const article = doc.querySelector('.article-content') || doc.querySelector('article');
    if (article) {
      // 본문 하단의 광고 및 이전/다음 버튼 영역 삭제
      const ads = article.querySelectorAll('.ad, .read-ad, a');
      ads.forEach(ad => {
        // 단, 본문 텍스트 내의 다른 태그는 냅두고 명백한 광고/링크만 삭제
        if (ad.href && (ad.href.includes('prev') || ad.href.includes('next') || ad.href.includes('page'))) {
          ad.remove();
        }
      });
      contentHtml = article.innerHTML;
    }
  } else if (url.includes('jjwxc')) {
    // 진강문학성은 <div id="novelcontent"> 또는 <td> 안에 본문이 들어있음
    const contentArea = doc.querySelector('#novelcontent') || doc.querySelector('.novelcontent');
    if (contentArea) {
      contentHtml = contentArea.innerHTML;
    }
  } else if (url.includes('archiveofourown') || url.includes('ao3')) {
    // AO3는 <div id="chapters"> 또는 <div class="userstuff"> 안에 본문이 있음
    const chapters = doc.querySelector('#chapters') || doc.querySelector('.userstuff');
    if (chapters) {
      contentHtml = chapters.innerHTML;
    }
  }

  // 만약 도메인별 특화 파싱에 실패했다면, 브라우저 표준 리더기 알고리즘 모방 (일반 p태그 본문 수집)
  if (!contentHtml) {
    const paragraphs = doc.querySelectorAll('p');
    if (paragraphs.length > 5) {
      contentHtml = Array.from(paragraphs).map(p => p.outerHTML).join('\n');
    } else {
      // 최후의 보루: Body 전체 텍스트에서 줄바꿈을 p태그화
      const bodyText = doc.body?.innerText || '';
      contentHtml = bodyText.split('\n').map(line => line.trim() ? `<p>${line.trim()}</p>` : '').join('\n');
    }
  }

  // 정제화 작업: 본문 안의 불필요한 스크립트, 광고성 배너 잔재들 최종 소거
  const cleanDoc = parser.parseFromString(contentHtml, 'text/html');
  const scripts = cleanDoc.querySelectorAll('script, style, iframe, ins');
  scripts.forEach(s => s.remove());

  // 문장별로 번역하기 쉽게 p태그 배열 형태로 원문 라인들을 리턴
  const paragraphNodes = cleanDoc.querySelectorAll('p, div, br');
  const paragraphsList = [];
  
  paragraphNodes.forEach(node => {
    const text = node.textContent?.trim();
    // 의미 있는 텍스트만 필터링
    if (text && text.length > 1 && !text.startsWith('http') && !text.includes('上一页')) {
      paragraphsList.push(text);
    }
  });

  return {
    title,
    paragraphs: paragraphsList
  };
}
