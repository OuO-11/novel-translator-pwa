import { translateTextWithRotation } from './apiRotator.js';

/**
 * 1. 목록 번역 (Full Web Page Mode)
 * 원본 HTML 스트링을 받아, 레이아웃(태그 구조)은 100% 유지한 채 
 * 텍스트가 들어있는 노드들만 찾아내 실시간으로 번역하여 주입한 뒤 완성된 HTML을 반환합니다.
 * @param {string} rawHtml 원본 HTML 소스
 * @param {string} systemPrompt 적용할 소설/목록 번역 프롬프트
 * @param {string} model 사용할 Gemini 모델
 * @param {function} onProgress 진행률 업데이트 콜백 (0 ~ 100)
 * @param {object} cancelRef 중지 처리용 ref
 */
export async function translateFullPage(rawHtml, systemPrompt, model, onProgress = () => {}, cancelRef = null) {
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
  const BATCH_SIZE = 15;
  let translatedCount = 0;

  for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
    // [37단계] 중지 신호 감지 시 즉시 루프 탈출
    if (cancelRef && cancelRef.current === true) {
      console.log('[Full Page Translator] Cancelled by user.');
      break;
    }

    const batch = textNodes.slice(i, i + BATCH_SIZE);
    
    // 번들 구조화: 번역기가 노드 순서를 매핑할 수 있도록 임의의 구분자(ID) 주입
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
      batch.forEach(node => {
        node.nodeValue = `${node.nodeValue} (번역 실패)`;
      });
    }

    translatedCount += batch.length;
    onProgress(Math.min(Math.round((translatedCount / totalNodes) * 100), 100));
  }

  return doc.documentElement.outerHTML;
}

/**
 * 2. 소설 본문 내용 파싱 (Reader Mode)
 * 원본 HTML 소스를 분석하여 소설 본문의 제목, 문단 배열, 이전화/다음화 주소를 지능형으로 추출하여 구조화합니다.
 */
export function extractNovelContent(rawHtml, url) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 번역 방해 노이즈 노드(헤더, 푸터, 댓글창, 추천 도서 등) 사전 영구 제거 (14단계)
  const trashSelectors = [
    'header', 'footer', '#footer', '.footer', 'noscript', 'iframe', 'ins', 'script', 'style',
    '.comment', '.comments', '#comments', '.reply', '.replies', '#replies', '.ad-box', '.ads',
    '.right-sidebar', '.sidebar', '.menu', '.navigation', '.breadcrumb', '.breadcrumbs'
  ];
  const trashNodes = doc.querySelectorAll(trashSelectors.join(','));
  trashNodes.forEach(t => t.remove());
  
  let title = doc.querySelector('title')?.textContent?.trim() || '제목 없음';
  let contentHtml = '';

  // 도메인별 소설 본문 영역 파싱 규칙 커스텀 (52shuku, 진강문학성 등)
  if (url.includes('52shuku')) {
    const article = doc.querySelector('.article-content') || doc.querySelector('article');
    if (article) {
      const targetSelectors = ['.read-page', '.page-link', '.book-page', '.pages', '.ad', '.read-ad'];
      targetSelectors.forEach(sel => {
        const els = article.querySelectorAll(sel);
        els.forEach(el => el.remove());
      });

      const navElements = article.querySelectorAll('p, div');
      navElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (
          (text.includes('上一页') && text.includes('下一页')) ||
          (text.includes('이전 페이지') && text.includes('다음 페이지')) ||
          (text.includes('목차') && text.includes('다음화')) ||
          (text.includes('目录') && text.includes('下一章'))
        ) {
          el.remove();
        }
      });

      contentHtml = article.innerHTML;
    }
  } else if (url.includes('jjwxc')) {
    let contentArea = doc.querySelector('#novelcontent') || 
                      doc.querySelector('.novelcontent') || 
                      doc.querySelector('.noveltext') || 
                      doc.querySelector('#content') ||
                      doc.querySelector('td.noveltext');

    if (!contentArea && (url.includes('m.jjwxc.net') || url.includes('m.jjwxc'))) {
      const candidates = doc.querySelectorAll('.b.module, div[class*="module"], .note_main');
      let longestDiv = null;
      let maxLen = 0;
      candidates.forEach(el => {
        const textLen = el.textContent?.trim().length || 0;
        if (textLen > maxLen) {
          maxLen = textLen;
          longestDiv = el;
        }
      });
      if (longestDiv && maxLen > 300) {
        contentArea = longestDiv;
      }
    }

    if (contentArea) {
      const navSelects = ['.nav', '.novel_nav', 'a', 'style', 'script', '#comment_list_new', '.recommend_novel_box'];
      navSelects.forEach(sel => {
        contentArea.querySelectorAll(sel).forEach(el => el.remove());
      });
      contentHtml = contentArea.innerHTML;
    }
  } else if (url.includes('archiveofourown') || url.includes('ao3')) {
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
      const bodyText = doc.body?.innerText || '';
      contentHtml = bodyText.split('\n').map(line => line.trim() ? `<p>${line.trim()}</p>` : '').join('\n');
    }
  }

  // 이전화, 다음화, 목차 링크 수집 (18단계 핵심)
  let prevUrl = '';
  let nextUrl = '';
  let indexUrl = '';

  const links = doc.querySelectorAll('a');
  links.forEach(a => {
    const text = a.textContent?.trim() || '';
    const href = a.getAttribute('href') || '';
    if (!href) return;

    if (text.includes('上一页') || text.includes('이전 페이지') || text.includes('이전화') || text.includes('上一章')) {
      prevUrl = href;
    } else if (text.includes('下一页') || text.includes('다음 페이지') || text.includes('다음화') || text.includes('下一章')) {
      nextUrl = href;
    } else if (text.includes('目录') || text.includes('목차') || text.includes('목록') || text.includes('返回书页')) {
      indexUrl = href;
    }
  });

  // 상대 경로 절대 경로화 보정
  const makeAbsolute = (base, relative) => {
    if (!relative) return '';
    try {
      return new URL(relative, base).toString();
    } catch(e) {
      return relative;
    }
  };

  prevUrl = makeAbsolute(url, prevUrl);
  nextUrl = makeAbsolute(url, nextUrl);
  indexUrl = makeAbsolute(url, indexUrl);

  // 정제화 작업: 본문 안의 불필요한 스크립트, 광고성 배너 잔재들 최종 소거
  const cleanDoc = parser.parseFromString(contentHtml, 'text/html');
  const scripts = cleanDoc.querySelectorAll('script, style, iframe, ins');
  scripts.forEach(s => s.remove());

  // [39단계 구조적 해결] <a> 링크 태그들을 본문 추출용 cleanDoc DOM에서 영구 제거
  // 본문 안에는 <a> 링크가 들어가지 않으므로, <a> 태그를 날려주면 
  // 'Top', '目录', '이전화' 등 페이지 내비게이션 버튼 찌꺼기가 텍스트 블랙리스트 없이 깔끔하게 걸러집니다.
  cleanDoc.querySelectorAll('a').forEach(a => a.remove());

  // [34단계 핵심: 줄바꿈 분할 및 jjwxc 전용 블랙리스트 필터링 도입]
  // 1. <br> 태그들을 \n 줄바꿈 문자로 변환하여 한 덩어리의 텍스트 안에서 문단 구분이 깨지지 않게 보정
  const brs = cleanDoc.querySelectorAll('br');
  brs.forEach(br => {
    const textNode = cleanDoc.createTextNode('\n');
    br.parentNode?.replaceChild(textNode, br);
  });

  const paragraphsList = [];
  
  // 2. 전체 HTML 본문을 \n 기준으로 쪼개어 가공
  const rawText = cleanDoc.body?.textContent || '';
  const lines = rawText.split('\n');

  // jjwxc 및 52shuku 꼬리말/작가의 말/댓글 영역 전역 블랙리스트 키워드들
  // (본문 중 정상적으로 출현할 수 있는 'Top'이나 '目录' 같은 단어는 단어 블랙리스트에서 제외)
  const BLACKLIST_KEYWORDS = [
    '哦豁', '52书库', '传送门：', '排行榜单', '书库不错的',
    '试试作家助手好不好用', '作者有话说', '显示所有文의作话', 
    '第1章', '昵称：', '评分：', '鲜花一捧', '交流灌水', 
    '别字提虫', '一块小砖', '别字', '灌水', '发表',
    '支持手机版', '晋江文学城', 'jjwxc', '本站', '作话',
    '小说在线阅读', '本章未完', '点击下一页', '无广告'
  ];

  lines.forEach(line => {
    const text = line.trim();
    // [39단계] 텍스트가 존재하고, 최소 4글자 이상이며, URL이나 숫자가 아닐 때만 수집 (2차 필터링)
    if (text && text.length >= 4 && !text.startsWith('http') && isNaN(text)) {
      // 블랙리스트 키워드 매칭 감시
      const isBlacklisted = BLACKLIST_KEYWORDS.some(keyword => text.includes(keyword));
      if (isBlacklisted) return;
      
      paragraphsList.push(text);
    }
  });

  return {
    title,
    paragraphs: paragraphsList,
    prevUrl,
    nextUrl,
    indexUrl
  };
}
