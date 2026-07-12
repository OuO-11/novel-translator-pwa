import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings, FolderHeart, Star, Trash2, Plus, Download, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { openDB, saveNovel, getNovels, deleteNovel, saveEpisode, getEpisode, clearOldEpisodes, getCacheStatistics } from './db.js';
import { getApiKeys, saveApiKeys, getActiveApiKey, fetchAvailableModels, translateTextWithRotation, translateTextStreamWithRotation } from './apiRotator.js';
import { getPromptsTree, savePreset, deletePreset, getPromptContent } from './promptManager.js';
import { translateFullPage, extractNovelContent } from './parser.js';
import { downloadCachedEpisodes } from './downloader.js';


// 언어별 전용 기본 번역기 프롬프트 (프롬프트 1) 기본값 정의 (비구씨 정밀 번역 규칙 기반 탑재)
const DEFAULT_BASE_PROMPTS = {
  chinese: `You are a professional literary translator specializing in translating Chinese web novels into natural, fluent, and engaging Korean. Follow these instructions:

1. Translate the source text into natural Korean novel style (소설체). Avoid mechanical direct translation.
2. Translate dialogues using natural Korean colloquial style.
3. Return only the translated Korean text without any notes, explanations, or original Chinese text.

[번역 지침]
- 각 캐릭터의 말투 및 어투는 해당 캐릭터의 개성이 잘 드러나도록 자연스럽게 번역합니다. 의역을 적절히 사용하십시오.
- 일반적인 한국어 소설처럼 문장 부호를 씁니다. 대사는 큰따옴표("")로, 독백이나 생각은 작은따옴표('')로 표현합니다.

[중국어 고유명사 지침]
- 중화권의 인명은 기본적으로 한국 한자음으로 씁니다. (예: 毛泽东 -> 모택동 / 成龍 -> 성룡 / 周明瑞 -> 주명서 / 小龍女 -> 소용녀)
- 단, 현대 배경의 단어가 한국에서 이미 원음 표기로 매우 잘 알려진 경우는 알려진 표기를 따릅니다. (예: 习近平 -> 시진핑 / 北京 -> 베이징 / 上海 -> 상하이)
- 배경이 무협/선협/대체역사 장르의 소설이라면, 중국어 고유명사는 무조건 한국 한자음으로 씁니다. (예: 北京 -> 북경 / 上海 -> 상해 / 北冥神功 -> 북명신공)`,
  japanese: `You are a professional literary translator specializing in translating Japanese light novels and web novels into natural and engaging Korean. Follow these instructions:

1. Translate into fluent Korean light novel style. Avoid direct translation of Japanese grammar style (e.g., '~의 경우', '~에 있어서' 같은 직역 지양).
2. Translate dialogues naturally based on character relationships and personality.
3. Return only the Korean translation.
4. Keep the character names consistent in official Korean localizations.`
};

// 리더기 테마 및 스타일 기본값 정의 (리디/카카페 감성의 웜 다크 테마 기본 장착)
const DEFAULT_READER_SETTINGS = {
  fontFamily: 'system-ui',
  fontColor: '#eaeae0',
  bgColor: '#121310',
  opacity: 45,
  fontSize: 17,
  fontWeight: 400,
  paddingX: 20,
  lineHeight: 1.8,
  paragraphGap: 20,
  textIndent: 0,
  keepOriginalText: true,
  removeTitle: false,
  removeOriginalNewlines: false,
  removeHtmlOnDownload: true,
  googleTranslate: false,
  googlePronunciation: false,
  showOriginalFirst: false,
  removeEmptyLines: true,
  bottomSpacing: true
};

function App() {
  const [activeTab, setActiveTab] = useState('library');
  const [novels, setNovels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 설정 상태
  const [apiKeysInput, setApiKeysInput] = useState('');
  const [availableModels, setAvailableModels] = useState(() => {
    const cached = localStorage.getItem('noveltrans_cached_models');
    return cached ? JSON.parse(cached) : ['gemini-3.1-flash-lite'];
  });
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-lite');
  
  // 프롬프트 1 (Base Prompt): 언어별 기본 번역기 프롬프트 상태
  const [basePrompts, setBasePrompts] = useState(() => {
    const cached = localStorage.getItem('noveltrans_base_prompts');
    return cached ? JSON.parse(cached) : DEFAULT_BASE_PROMPTS;
  });

  // 프롬프트 2 (Sub Preset): 추가 커스텀 템플릿 트리 상태
  const [promptsTree, setPromptsTree] = useState(() => getPromptsTree());
  const [selectedLang, setSelectedLang] = useState('chinese'); // 번역 언어 모드 (chinese, japanese)
  const [selectedPreset, setSelectedPreset] = useState('default'); // 추가 커스텀 프리셋
  const [cacheStats, setCacheStats] = useState({ totalNovels: 0, totalCachedEpisodes: 0 });

  // 프로프트 직접 추가 폼 상태
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetContent, setNewPresetContent] = useState('');

  // [37단계] 프리셋 내용 확인/수정 UI 상태
  const [editingPresetId, setEditingPresetId] = useState(null); // 현재 펼쳐진 프리셋 ID
  const [editingPresetContent, setEditingPresetContent] = useState(''); // 수정 중인 내용

  // 리더기 상세 커스텀 설정 상태
  const [readerSettings, setReaderSettings] = useState(() => {
    const cached = localStorage.getItem('noveltrans_reader_settings');
    return cached ? JSON.parse(cached) : DEFAULT_READER_SETTINGS;
  });
  
  // 아코디언 접기/열기 상태
  const [showThemeCollapse, setShowThemeCollapse] = useState(true);
  const [showMiscCollapse, setShowMiscCollapse] = useState(true);

  // 번역 입력 및 내부 모드 상태
  const [inputUrl, setInputUrl] = useState('');
  const [transMode, setTransMode] = useState('viewer'); // 'page' (목록 번역) or 'viewer' (본문 뷰어)
  const [transProgress, setTransProgress] = useState(0);
  const [isTranslating, setIsTranslating] = useState(false);
  const cancelTranslationRef = useRef(false);
  const translationAbortControllerRef = useRef(null);

  // 27단계 핵심: 설정/보관함 이동 후 실시간번역 탭 복귀 시 보던 뷰어 화면을 고스란히 복원하는 서브탭 상태 및 동기화 이펙트
  const [lastTranslateSubTab, setLastTranslateSubTab] = useState('translate');

  useEffect(() => {
    if (activeTab === 'translate' || activeTab === 'viewer' || activeTab === 'pageResult') {
      setLastTranslateSubTab(activeTab);
    }
  }, [activeTab]);

  // 뷰어 및 렌더링 상태
  const [viewerTitle, setViewerTitle] = useState('');
  const [viewerParagraphs, setViewerParagraphs] = useState([]); // [{ original, translated }]
  const [novelHtmlResult, setNovelHtmlResult] = useState(''); // 목록 번역 html 결과
  const [pageSystemPrompt, setPageSystemPrompt] = useState(''); // [39단계] 목록 번역 백그라운드 프롬프트
  const [activeViewerNovelId, setActiveViewerNovelId] = useState(null);
  const [activeViewerChapter, setActiveViewerChapter] = useState(1);
  const [viewerPrevUrl, setViewerPrevUrl] = useState('');
  const [viewerNextUrl, setViewerNextUrl] = useState('');
  const [viewerIndexUrl, setViewerIndexUrl] = useState('');

  const [clickedOriginals, setClickedOriginals] = useState({});
  const handleParagraphClick = (idx) => {
    if (readerSettings.opacity === 0) {
      setClickedOriginals(prev => ({
        ...prev,
        [idx]: !prev[idx]
      }));
    }
  };

  // 백엔드 Vercel 실시간 로그 대시보드로 클라이언트 런타임 오류 리포트 전송
  const reportErrorToBackend = async (error, contextInfo = '') => {
    try {
      const errorPayload = {
        time: new Date().toISOString(),
        message: error.message || String(error),
        stack: error.stack || 'No stack trace details provided.',
        url: window.location.href,
        context: contextInfo
      };
      console.error("Reporting Error to Vercel Console:", errorPayload);
      
      await fetch('/api/log_error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorPayload)
      });
    } catch (e) {
      console.error("Failed to route runtime error to Vercel logger:", e);
    }
  };

  // 최신 inputUrl 값을 참조하기 위한 ref (iframe 비동기 핸들러용)
  const inputUrlRef = useRef(inputUrl);
  useEffect(() => {
    inputUrlRef.current = inputUrl;
  }, [inputUrl]);

  // 1. 초기 로드 및 모델 목록 캐시 동기화 + 전역 런타임 에러 추적 리스너 등록
  useEffect(() => {
    // 런타임 에러 전역 트래킹 핸들러
    const handleGlobalError = (event) => {
      reportErrorToBackend(event.error || new Error(event.message), 'Global window.onerror capture');
    };
    const handleUnhandledRejection = (event) => {
      reportErrorToBackend(event.reason || new Error('Unhandled Promise Rejection'), 'Global Promise Rejection capture');
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    async function init() {
      try {
        await openDB();
        const list = await getNovels();
        setNovels(list);
        
        // API Key 로드
        const keys = getApiKeys();
        setApiKeysInput(keys.join('\n'));
        
        // 프롬프트 로드
        setPromptsTree(getPromptsTree());

        // 통계 로드
        const stats = await getCacheStatistics();
        setCacheStats(stats);

        // 첫 번째 API Key를 활용하여 구글 ListModels API 백그라운드 캐시 최신화
        if (keys.length > 0) {
          loadModels(keys[0]);
        }
      } catch (e) {
        console.error('Init error:', e);
        reportErrorToBackend(e, 'App DB initialization sequence');
      } finally {
        setIsLoading(false);
      }
    }
    init();

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);


  // 용어 사전 동적 필터
  const filterActiveGlossary = (rawSubPrompt, originalTextSegment) => {
    if (!rawSubPrompt) return '';
    const lines = rawSubPrompt.split('\n');
    
    const matchedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      const match = trimmed.match(/(.*?)(?:->|=|\:)/);
      const keyword = match 
        ? match[1].replace(/[-*\s]/g, '').trim()
        : trimmed.trim();

      return keyword && keyword.length >= 2 && originalTextSegment.includes(keyword);
    });

    return matchedLines.join('\n');
  };

  // 리더기 커스텀 설정 변경 핸들러
  const handleUpdateReaderSetting = (key, value) => {
    const updated = { ...readerSettings, [key]: value };
    setReaderSettings(updated);
    localStorage.setItem('noveltrans_reader_settings', JSON.stringify(updated));
  };

  // 기본 언어 번역기 프롬프트 (프롬프트 1) 개별 편집 및 저장 핸들러
  const handleUpdateBasePrompt = (lang, value) => {
    const updated = { ...basePrompts, [lang]: value };
    setBasePrompts(updated);
    localStorage.setItem('noveltrans_base_prompts', JSON.stringify(updated));
  };

  // URL에서 자동으로 화수(Chapter)를 파싱
  const detectChapterFromUrl = (url) => {
    if (!url) return 1;
    const shukuMatch = url.match(/_(\d+)\.html/i);
    if (shukuMatch) return parseInt(shukuMatch[1]);
    const jjwxcMatch = url.match(/[?&]chapterid=(\d+)/i);
    if (jjwxcMatch) return parseInt(jjwxcMatch[1]);
    const ao3Match = url.match(/\/chapters\/(\d+)/i);
    if (ao3Match) return parseInt(ao3Match[1]);
    const genericMatch = url.match(/\/(\d+)(?:\.html)?\/?$/i);
    if (genericMatch) return parseInt(genericMatch[1]);
    return 1;
  };

  // [소설 대표(마스터) 목차 URL 추출 알고리즘 (14단계 핵심)]
  // 개별 화수 주소에서 화수 번호를 제거하고 공통 소설 카드 식별 주소를 인출합니다.
  const getNovelMasterUrl = (url) => {
    if (!url) return '';
    try {
      // 52shuku: 예: .../bl/123_2.html -> .../bl/123.html
      let cleaned = url.replace(/_(\d+)\.html/i, '.html');
      // jjwxc: 예: .../book2/10860557/1 -> .../book2/10860557
      cleaned = cleaned.replace(/\/(\d+)\/?$/i, '');
      // ao3: 예: .../works/123/chapters/456 -> .../works/123
      cleaned = cleaned.replace(/\/chapters\/(\d+)/i, '');
      
      const urlObj = new URL(cleaned);
      urlObj.searchParams.delete('chapterid');
      return urlObj.toString();
    } catch (e) {
      return url;
    }
  };

  // 상세 소설 본문 화수 주소인지 감지하는 헬퍼 함수
  const isNovelEpisodeUrl = (url) => {
    if (!url) return false;
    return (
      url.match(/_(\d+)\.html/i) || 
      url.match(/[?&]chapterid=(\d+)/i) || 
      url.match(/\/chapters\/(\d+)/i) ||
      url.match(/\/(\d+)(?:\.html)?\/?$/i)
    );
  };

  // 신규 프롬프트 프리셋 직접 추가 기능 (38단계: 수정 모드 분기 통합)
  const handleAddCustomPreset = () => {
    if (!newPresetName) {
      return alert('프리셋 이름을 입력해 주세요.');
    }
    // 수정 모드: 기존 presetId를 덮어씁니다
    if (editingPresetId && editingPresetId !== 'default') {
      try {
        const updatedTree = savePreset(selectedLang, editingPresetId, newPresetName, newPresetContent);
        setPromptsTree(updatedTree);
        setEditingPresetId(null);
        setNewPresetName('');
        setNewPresetContent('');
        alert('프리셋이 수정 저장되었습니다.');
      } catch (e) {
        alert(e.message);
      }
      return;
    }
    // 신규 생성 모드
    if (!newPresetContent) {
      return alert('프리셋 내용을 입력해 주세요.');
    }
    const presetId = 'custom_' + Date.now();
    try {
      const updatedTree = savePreset(selectedLang, presetId, newPresetName, newPresetContent);
      setPromptsTree(updatedTree);
      setSelectedPreset(presetId);
      setNewPresetName('');
      setNewPresetContent('');
      alert('새로운 프롬프트 템플릿이 성공적으로 저장되었습니다!');
    } catch (e) {
      alert(e.message);
    }
  };

  // 프롬프트 프리셋 삭제 기능
  const handleDeletePreset = (presetId) => {
    if (presetId === 'default') {
      return alert('기본 프리셋은 삭제할 수 없습니다.');
    }
    if (window.confirm('이 프롬프트 프리셋을 삭제하시겠습니까?')) {
      const updatedTree = deletePreset(selectedLang, presetId);
      setPromptsTree(updatedTree);
      setSelectedPreset('default');
      setEditingPresetId(null);
      if (editingPresetId === presetId) {
        setNewPresetName('');
        setNewPresetContent('');
      }
    }
  };

  // [38단계] 프리셋 클릭 시 하단 폼에 내용 채우기 (default 제외)
  const handleLoadPresetToForm = (presetId) => {
    if (presetId === 'default') return;
    const preset = currentPresets[presetId];
    if (!preset) return;
    setEditingPresetId(presetId);
    setNewPresetName(preset.name || '');
    setNewPresetContent(preset.content || '');
  };

  // iframe 내부 상대 경로를 원본 사이트 절대 경로로 매핑 복구
  const resolveAbsoluteUrl = (currentInputUrl, clickedUrl) => {
    try {
      const inputOrigin = new URL(currentInputUrl).origin;
      const clickedObj = new URL(clickedUrl);
      if (clickedObj.host === window.location.host) {
        return inputOrigin + clickedObj.pathname + clickedObj.search + clickedObj.hash;
      }
      return clickedUrl;
    } catch (e) {
      return clickedUrl;
    }
  };

  // 주소 변경 시 모드 및 화수 자동 동기화
  const handleUrlChange = (e) => {
    const url = e.target.value;
    setInputUrl(url);
    
    if (isNovelEpisodeUrl(url)) {
      setTransMode('viewer');
      const detectedChapter = detectChapterFromUrl(url);
      setActiveViewerChapter(detectedChapter);
    } else {
      setTransMode('page');
    }
  };

  // API 호출을 통해 사용 가능한 모델 목록 갱신 및 캐싱
  const loadModels = async (key) => {
    if (!key) return;
    const fetchedList = await fetchAvailableModels(key);
    if (fetchedList && fetchedList.length > 0) {
      setAvailableModels(fetchedList);
      localStorage.setItem('noveltrans_cached_models', JSON.stringify(fetchedList));
      if (!fetchedList.includes(selectedModel)) {
        setSelectedModel(fetchedList[0]);
      }
    }
  };

  // 설정 저장 및 동적 모델 리프레시
  const handleSaveSettings = async () => {
    const keys = apiKeysInput.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    saveApiKeys(keys);
    alert('설정이 저장되었습니다. 최신 AI 모델을 동적으로 리프레시합니다.');
    if (keys.length > 0) {
      await loadModels(keys[0]);
    }
    getCacheStatistics().then(setCacheStats);
  };


  // 소설 삭제
  const handleDeleteNovel = async (id, title, e) => {
    e.stopPropagation();
    if (window.confirm(`[${title}] 소설과 로컬 캐시를 삭제하시겠습니까?`)) {
      await deleteNovel(id);
      const list = await getNovels();
      setNovels(list);
      getCacheStatistics().then(setCacheStats);
    }
  };

  // 소설 다운로드
  const handleDownload = async (novel, e) => {
    e.stopPropagation();
    try {
      const fileName = await downloadCachedEpisodes(novel.id, novel.title, novel.site || '기타');
      alert(`다운로드 완료: ${fileName}`);
    } catch (err) {
      alert(err.message);
      reportErrorToBackend(err, `handleDownload for novel: ${novel.title}`);
    }
  };

  // [39단계 핵심: iframe 문서 내 텍스트 노드 실시간 번역 교체 함수 (비구씨/콜로모 방식)]
  const translateIframeDocument = async (iframeDoc, systemPrompt, model, cancelRef) => {
    const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE'];
    const textNodes = [];

    // DOM 트리를 재귀적으로 순회하며 번역할 텍스트 노드 수집
    function walk(node) {
      if (node.nodeType === Node.ELEMENT_NODE && EXCLUDE_TAGS.includes(node.tagName)) {
        return;
      }
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

    try {
      walk(iframeDoc.body || iframeDoc);
    } catch (e) {
      console.warn("DOM walk failed:", e);
    }

    const totalNodes = textNodes.length;
    if (totalNodes === 0) {
      setIsTranslating(false);
      setTransProgress(100);
      return;
    }

    console.log(`[Iframe Real-time Translator] Found ${totalNodes} text nodes to translate.`);

    const BATCH_SIZE = 15;
    let translatedCount = 0;

    for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
      if (cancelRef && cancelRef.current === true) {
        console.log('[Iframe Real-time Translator] Cancelled by user.');
        break;
      }

      const batch = textNodes.slice(i, i + BATCH_SIZE);
      const batchText = batch.map((node, index) => `[${index}] ${node.nodeValue.trim()}`).join('\n');
      const batchPrompt = `${systemPrompt}\n\nIMPORTANT: You must translate each line marked with '[number]' in order. Maintain the format '[number] Translated text'. Do not merge lines or omit numbers.`;

      try {
        const translatedBatch = await translateTextWithRotation(batchText, batchPrompt, model);
        
        // 번역 결과를 실제 iframe 문서 노드에 즉시 주입 (실시간 화면 한글 변환!)
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

        batch.forEach((node, index) => {
          if (translationMap[index]) {
            node.nodeValue = translationMap[index];
          }
        });

      } catch (e) {
        console.error(`[Iframe Batch Failed] Index ${i} to ${i + BATCH_SIZE}:`, e);
        batch.forEach(node => {
          node.nodeValue = `${node.nodeValue} (번역 실패)`;
        });
      }

      translatedCount += batch.length;
      const progressPercent = Math.min(Math.round((translatedCount / totalNodes) * 100), 100);
      setTransProgress(progressPercent);
    }

    setIsTranslating(false);
  };

  // 실시간 번역 공통 구동 코어 함수
  const triggerTranslationFlow = async (targetUrl, targetMode, forceChapter = null, bypassCache = false) => {
    const activeKey = getActiveApiKey();
    if (!activeKey) {
      alert('API Key를 먼저 설정에서 1개 이상 등록해 주세요.');
      setActiveTab('presets');
      return;
    }

    setIsTranslating(true);
    cancelTranslationRef.current = false;
    setClickedOriginals({});
    setTransProgress(5);
    setNovelHtmlResult('');
    setViewerParagraphs([]);

    const basePrompt = basePrompts[selectedLang] || '';
    const rawSubPrompt = selectedPreset === 'default' ? '' : getPromptContent(selectedLang, selectedPreset);
    const chapterToUse = forceChapter !== null ? forceChapter : detectChapterFromUrl(targetUrl);

    try {
      setTransProgress(20);
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);
      if (!res.ok) throw new Error('CORS 프록시 서버 통신 실패');
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const tempTitle = data.html.match(/<title>(.*?)<\/title>/i)?.[1] || '번역된 소설';
      const siteName = targetUrl.includes('52shuku') ? '52shuku' : targetUrl.includes('jjwxc') ? '진강문학성' : targetUrl.includes('ao3') ? 'AO3' : '기타';

      if (targetMode === 'page') {
        const activeSubPrompt = filterActiveGlossary(rawSubPrompt, data.html);
        const finalSystemPrompt = activeSubPrompt 
          ? `${basePrompt}\n\n[추가 특정 작품/용어 사전 지침]\n${activeSubPrompt}` 
          : basePrompt;

        setPageSystemPrompt(finalSystemPrompt);
        setTransProgress(5);
        // 원본 중국어 HTML을 iframe에 즉시 주입하여 사이트를 바로 렌더링 (비구씨/콜로모 스타일)
        setNovelHtmlResult(data.html);
        setActiveTab('pageResult');
      } else {
        const { title, paragraphs, prevUrl, nextUrl, indexUrl } = extractNovelContent(data.html, targetUrl);
        
        if (!paragraphs || paragraphs.length === 0) {
          throw new Error('소설 본문을 사이트로부터 정상적으로 긁어오지 못했습니다. 본문이 있는 정상적인 뷰어 주소인지 확인해 주세요.');
        }
        
        // 21단계 핵심: 소설 제목 한글 자동 번역 및 한글/원문 대조 병기 합성
        let translatedTitle = title;
        try {
          translatedTitle = await translateTextWithRotation(
            title, 
            "Translate this novel title into natural, clean Korean. Return ONLY the translated Korean text without any other explanations or punctuation.", 
            selectedModel
          );
        } catch (e) {
          console.warn("Title translation fallback:", e);
        }
        
        const combinedTitle = `${translatedTitle.trim()} / ${title.trim()}`;
        setViewerTitle(combinedTitle);
        setViewerPrevUrl(prevUrl || '');
        setViewerNextUrl(nextUrl || '');
        setViewerIndexUrl(indexUrl || '');
        
        // [소설 마스터 키 중복 제거 적재 알고리즘 (14단계)]
        // 동일 소설이 이미 저장소(novels)에 있는지 제목 또는 대표 목차 URL을 훑어 검색
        const masterUrl = getNovelMasterUrl(targetUrl);
        const existingNovel = novels.find(n => n.masterUrl === masterUrl || n.title === combinedTitle || n.title === title);
        
        let novelId;
        if (existingNovel) {
          // 이미 존재한다면, 소설 ID를 보존한 채 마지막 읽은 화수와 마지막 읽은 주소만 최신값으로 덮어쓰기 업데이트
          novelId = existingNovel.id;
          await saveNovel({
            ...existingNovel,
            lastReadChapter: chapterToUse,
            lastReadUrl: targetUrl,
            lang: selectedLang,
            presetId: selectedPreset,
            updatedAt: Date.now()
          });
        } else {
          // 신규 소설일 시 신규 등록 (합성 병기된 제목 저장)
          novelId = await saveNovel({
            title: combinedTitle,
            masterUrl,
            url: targetUrl,
            lastReadUrl: targetUrl,
            site: siteName,
            lastReadChapter: chapterToUse,
            lang: selectedLang,
            presetId: selectedPreset,
            updatedAt: Date.now()
          });
        }
        
        // 소설 정보 저장 후 novels React 목록을 즉시 갱신하여 연속 번역 시 중복 적재 발생 차단
        const updatedList = await getNovels();
        setNovels(updatedList);

        setActiveViewerNovelId(novelId);

        const cached = bypassCache ? null : await getEpisode(novelId, chapterToUse);
        if (cached) {
          const parsedLines = JSON.parse(cached.translatedText);
          const origLines = JSON.parse(cached.originalText || '[]');
          const formatted = parsedLines.map((t, i) => ({ translated: t, original: origLines[i] || '' }));
          setViewerParagraphs(formatted);
          setTransProgress(100);
          setActiveTab('viewer');
        } else {
          const initialViewerLines = paragraphs.map(p => ({ original: p, translated: 'AI 번역 대기 중...' }));
          setViewerParagraphs(initialViewerLines);
          setActiveTab('viewer');

          // AbortController 기동 (23단계 핵심)
          translationAbortControllerRef.current = new AbortController();

          // 1회 묶음 프롬프트 구성 (RPD 1회 소모)
          const fullOriginalText = paragraphs.join('\n');
          const activeSubPrompt = filterActiveGlossary(rawSubPrompt, fullOriginalText);
          
          // 계층 프롬프트 합성 및 대량 단락 순서/형식 유지 엄격한 지시어 병합
          const baseSystemPrompt = activeSubPrompt 
            ? `${basePrompt}\n\n[추가 특정 작품/용어 사전 지침]\n${activeSubPrompt}` 
            : basePrompt;

          const finalSystemPrompt = `${baseSystemPrompt}\n\nIMPORTANT: You must translate each line marked with '[number]' in order. Maintain the format '[number] Translated text'. Do not merge lines or omit numbers.`;

          const translatedList = new Array(paragraphs.length).fill('');

          // 24단계 핵심: 초장문/출력한계 대비 자동 연쇄 스트리밍 루프 구동
          let doneTranslation = false;
          let continuationCount = 0;
          const maxContinuationAttempts = 4; // 최대 4차 연쇄까지 지원 (약 3만자 이상 초장문 방어)

          while (!doneTranslation && continuationCount < maxContinuationAttempts) {
            // 아직 번역이 완료되지 않은 미완성 단락 인덱스만 추출
            const pendingIndices = [];
            paragraphs.forEach((p, idx) => {
              if (translatedList[idx] === '' || translatedList[idx] === undefined) {
                pendingIndices.push(idx);
              }
            });

            // 모든 단락의 번역이 완수되었다면 즉시 연쇄 루프 탈출!
            if (pendingIndices.length === 0) {
              doneTranslation = true;
              break;
            }

            console.log(`[Translation Continuation #${continuationCount + 1}] Processing ${pendingIndices.length} pending paragraphs...`);

            // 남은 미완성 단락들만 2차 묶음으로 선별 합성
            const pendingRawText = pendingIndices.map(idx => `[${idx}] ${paragraphs[idx].trim()}`).join('\n');

            try {
              // 1회 호출 실시간 스트리밍 구동
              await translateTextStreamWithRotation(
                pendingRawText,
                finalSystemPrompt,
                selectedModel,
                (accumulated) => {
                  // 스트리밍 텍스트가 수신될 때마다 파싱하여 화면에 실시간 주입
                  const lines = accumulated.split('\n');
                  const translationMap = {};
                  let maxProcessedIndex = -1;

                  lines.forEach(line => {
                    const match = line.match(/^\[(\d+)\]\s*(.*)/);
                    if (match) {
                      const idx = parseInt(match[1]);
                      const translatedVal = match[2].trim();
                      if (pendingIndices.includes(idx)) {
                        translationMap[idx] = translatedVal;
                        translatedList[idx] = translatedVal;
                        if (idx > maxProcessedIndex) {
                          maxProcessedIndex = idx;
                        }
                      }
                    }
                  });

                  setViewerParagraphs(prev => {
                    const next = [...prev];
                    paragraphs.forEach((orig, idx) => {
                      if (translatedList[idx] !== undefined && translatedList[idx] !== '') {
                        next[idx] = { original: orig, translated: translatedList[idx] };
                      } else if (pendingIndices.includes(idx) && idx <= maxProcessedIndex) {
                        next[idx] = { original: orig, translated: 'AI 번역 가동 중...' };
                      } else if (pendingIndices.includes(idx)) {
                        next[idx] = { original: orig, translated: 'AI 번역 대기 중...' };
                      }
                    });
                    return next;
                  });

                  const completedCount = translatedList.filter(t => t !== '').length;
                  const percent = Math.min(Math.round((completedCount / paragraphs.length) * 100), 99);
                  setTransProgress(percent);
                },
                translationAbortControllerRef.current.signal
              );
            } catch (streamErr) {
              console.warn(`[Stream Continuation Warning] Attempt ${continuationCount + 1} encountered error:`, streamErr);
              
              // 긴급 중지 또는 Abort 된 경우 루프 파쇄 탈출
              if (cancelTranslationRef.current || streamErr.message?.includes('중단')) {
                throw streamErr;
              }
              
              // 다음 키로 시도할 기회를 주기 위해 강제 delay를 살짝 둔다
              await new Promise(r => setTimeout(r, 1000));
            }

            continuationCount++;
          }

          // 루프가 도는 동안 비어 있는 인덱스 보정 (누락 및 가동중 텍스트 잔재 소거)
          setViewerParagraphs(prev => {
            return prev.map((p, idx) => {
              const finalTrans = translatedList[idx];
              const hasDummy = finalTrans === 'AI 번역 대기 중...' || finalTrans === 'AI 번역 가동 중...' || !finalTrans;
              return {
                original: p.original,
                translated: hasDummy ? `${p.original} (번역 실패/미완료)` : finalTrans
              };
            });
          });

          // 최종 캐시 디스크 1회 기록
          const cleanTranslatedText = translatedList.map((t, idx) => t || paragraphs[idx]);
          await saveEpisode(novelId, chapterToUse, JSON.stringify(cleanTranslatedText), JSON.stringify(paragraphs));
        }
        
        getNovels().then(setNovels);
      }
    } catch (err) {
      alert('번역 중 오류가 발생했습니다: ' + err.message);
      reportErrorToBackend(err, `triggerTranslationFlow for ${targetUrl}`);
    } finally {
      setIsTranslating(false);
      getCacheStatistics().then(setCacheStats);
    }
  };

  // 수동 [번역 시작] 트리거
  const handleTranslateStart = () => {
    const finalMode = isNovelEpisodeUrl(inputUrl) ? 'viewer' : 'page';
    setTransMode(finalMode);
    
    const detectedChapter = detectChapterFromUrl(inputUrl);
    setActiveViewerChapter(detectedChapter);

    triggerTranslationFlow(inputUrl, finalMode, finalMode === 'viewer' ? detectedChapter : null);
  };

  // iframe 내부 링크 클릭 가로채기 핸들러
  const handleIframeNavigate = (clickedUrl) => {
    const originalAbsoluteUrl = resolveAbsoluteUrl(inputUrlRef.current, clickedUrl);
    
    if (isNovelEpisodeUrl(originalAbsoluteUrl)) {
      const detectedChapter = detectChapterFromUrl(originalAbsoluteUrl);
      setInputUrl(originalAbsoluteUrl);
      setTransMode('viewer');
      setActiveViewerChapter(detectedChapter);
      triggerTranslationFlow(originalAbsoluteUrl, 'viewer', detectedChapter);
    } else {
      setInputUrl(originalAbsoluteUrl);
      setTransMode('page');
      triggerTranslationFlow(originalAbsoluteUrl, 'page');
    }
  };

  // iframe 로드 완료 시 이벤트 캡처 주입
  const handleIframeLoad = (e) => {
    try {
      const iframe = e.target;
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      if (!iframeDoc) return;

      // [39단계 핵심] 번역 기동 상태라면 백그라운드에서 실시간 텍스트 번역 교체 태스크 가동 (비구씨/콜로모 스타일)
      if (isTranslating && !iframeDoc.__isTranslating) {
        iframeDoc.__isTranslating = true;
        translateIframeDocument(iframeDoc, pageSystemPrompt, selectedModel, cancelTranslationRef);
      }

      const links = iframeDoc.getElementsByTagName('a');
      for (let link of links) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const targetHref = link.href;
          if (targetHref) {
            handleIframeNavigate(targetHref);
          }
        });
      }
    } catch (err) {
      console.warn("Iframe click capture bypassed:", err);
    }
  };

  // [보관함 마지막 읽은 화수 이어보기 기능 결합]
  const handleLoadNovel = (novel) => {
    const urlToLoad = novel.lastReadUrl || novel.url; // 마지막 읽었던 화수 주소 우선 로드
    const chapterToLoad = novel.lastReadChapter || 1;

    if (novel.lang) {
      setSelectedLang(novel.lang);
    }
    if (novel.presetId) {
      setSelectedPreset(novel.presetId);
    }

    setInputUrl(urlToLoad);
    setTransMode('viewer');
    setActiveViewerChapter(chapterToLoad);
    setActiveTab('translate');

    // 보관함 소설 카드를 누르는 즉시 자동으로 번역 엔진을 구동해 감상창으로 워프합니다!
    triggerTranslationFlow(urlToLoad, 'viewer', chapterToLoad);
  };

  // 뷰어 하단 이전화/다음화/목차 클릭 액션 라우터 (18단계 핵심)
  const handleNavigateEpisode = (targetUrl) => {
    if (!targetUrl) return;

    setInputUrl(targetUrl);

    const isEpisode = isNovelEpisodeUrl(targetUrl);
    const detectedChapter = detectChapterFromUrl(targetUrl);
    const finalMode = isEpisode ? 'viewer' : 'page';

    setTransMode(finalMode);
    if (isEpisode) {
      setActiveViewerChapter(detectedChapter);
    }

    // 즉시 실시간 스트리밍 번역 구동
    triggerTranslationFlow(targetUrl, finalMode, isEpisode ? detectedChapter : null);
  };

  const handleClearCache = async () => {
    if (window.confirm('최근 30일 동안 읽지 않은 모든 번역 캐시 데이터를 소거하시겠습니까?')) {
      await clearOldEpisodes(30);
      alert('캐시 정리가 완료되었습니다.');
      getCacheStatistics().then(setCacheStats);
    }
  };

  const handleReportFeedback = async () => {
    if (viewerParagraphs.length === 0) {
      alert('현재 감상 중인 소설 텍스트가 존재하지 않아 신고할 수 없습니다.');
      return;
    }

    const confirmReport = window.confirm(
      "현재 뷰어 화면의 번역 결과(원본 문장, 번역문, 소설 주소, 번역 모델 등)를 개발자에게 피드백으로 전송하시겠습니까?\n\n*개인 API Key 등의 정보는 절대 포함되지 않으며 익명으로 안전하게 전송됩니다."
    );
    if (!confirmReport) return;

    try {
      const payload = {
        time: new Date().toISOString(),
        timestamp: Date.now().toString(),
        url: inputUrl,
        model: selectedModel,
        title: viewerTitle,
        chapter: activeViewerChapter,
        paragraphsCount: viewerParagraphs.length,
        paragraphs: viewerParagraphs.map(p => ({
          original: p.original || '',
          translated: p.translated || ''
        })),
        userAgent: navigator.userAgent
      };

      const res = await fetch('/api/report_feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`서버 응답 오류 (Status: ${res.status}, Body: ${errorText || '없음'})`);
      }
      const resData = await res.json();
      
      if (resData.status === 'submitted') {
        alert('피드백이 성공적으로 제출되었습니다. 감사합니다!');
      } else {
        alert('피드백 전송 완료 (로컬 기록됨)');
      }
    } catch (err) {
      alert('피드백 전송 도중 에러가 발생했습니다: ' + err.message);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#101210',
        color: '#e2e4e0',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          border: '4px solid #242824',
          borderTop: '4px solid #81c784',
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          animation: 'spin 1s linear infinite',
          marginBottom: '16px'
        }} />
        <span style={{ fontSize: '14px', color: '#aab0a6' }}>로컬 데이터베이스 연결 중...</span>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const currentPresets = promptsTree[selectedLang]?.presets || {};

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      backgroundColor: '#101210',
      color: '#e2e4e0',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* 헤더 (22단계: 뷰어 화면 진입 시 헤더를 숨겨 겹침 현상 해소 및 꽉 찬 화면 지원) */}
      {activeTab !== 'viewer' && (
        <header style={{
          display: 'flex',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid #242824',
          backgroundColor: '#0e100e',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: 'linear-gradient(135deg, #81c784, #83c5be)',
              padding: '8px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <BookOpen size={24} color="#11111b" />
            </div>
            <span style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '-0.5px' }}>
              Novel<span style={{ color: '#81c784' }}>Trans</span>
            </span>
          </div>
        </header>
      )}

      {/* 본문 콘텐츠: pageResult 및 viewer 탭에서는 여백 없이 full-width, 그 외에는 중앙 정렬 패딩 유지 */}
      <main style={{ 
        flex: 1, 
        padding: (activeTab === 'pageResult' || activeTab === 'viewer') ? '0' : '20px', 
        maxWidth: (activeTab === 'pageResult' || activeTab === 'viewer') ? '100%' : '650px', 
        margin: '0 auto', 
        width: '100%', 
        boxSizing: 'border-box' 
      }}>
        
        {/* 탭 1: 보관함 (Library) */}
        {activeTab === 'library' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>내 소설 보관함</h3>
            
            {novels.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '50px 20px',
                border: '2px dashed #242824',
                borderRadius: '16px',
                color: '#aab0a6'
              }}>
                보관함이 비어 있습니다. [실시간번역] 탭으로 이동하여 번역을 수행하면 소설이 이곳에 자동 적재됩니다.
              </div>
            ) : (
              novels.map(novel => (
                <div 
                  key={novel.id} 
                  onClick={() => handleLoadNovel(novel)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: '#0e100e',
                    border: '1px solid #242824',
                    borderRadius: '16px',
                    padding: '16px',
                    gap: '16px',
                    cursor: 'pointer',
                    transition: 'transform 0.15s'
                  }}
                >
                  <div style={{ backgroundColor: '#181c18', padding: '10px', borderRadius: '12px' }}>
                    <FolderHeart size={22} color="#e78284" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {novel.title}
                    </h4>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
                      <span style={{ backgroundColor: '#181c18', padding: '2px 6px', borderRadius: '4px', color: '#81c784' }}>{novel.site}</span>
                      <span style={{ color: '#aab0a6' }}>마지막으로 읽은 회차: {novel.lastReadChapter}화</span>
                    </div>
                  </div>
                  
                  {/* 조작 버튼 영역 */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={(e) => handleDownload(novel, e)}
                      style={{ background: 'none', border: 'none', color: '#a6d189', padding: '6px', cursor: 'pointer' }}
                      title="텍스트 파일 다운로드"
                    >
                      <Download size={18} />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteNovel(novel.id, novel.title, e)}
                      style={{ background: 'none', border: 'none', color: '#e78284', padding: '6px', cursor: 'pointer' }}
                      title="삭제"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 탭 2: 실시간 번역 (Translate) */}
        {activeTab === 'translate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>AI 실시간 번역 시작</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: '#aab0a6' }}>소설 주소 (URL)</label>
              <input 
                type="text" 
                placeholder="예: https://www.52shuku.net/bl/..." 
                value={inputUrl}
                onChange={handleUrlChange}
                style={{
                  backgroundColor: '#0e100e',
                  border: '1px solid #242824',
                  borderRadius: '10px',
                  padding: '12px',
                  color: '#e2e4e0',
                  fontSize: '14px'
                }}
              />
            </div>

            {/* 번역 옵션 그룹 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#aab0a6' }}>번역 모드 (언어 선택)</label>
                <select 
                  value={selectedLang} 
                  onChange={(e) => {
                    setSelectedLang(e.target.value);
                    setSelectedPreset('default');
                  }}
                  style={{
                    backgroundColor: '#0e100e', border: '1px solid #242824', borderRadius: '8px', padding: '8px', color: '#e2e4e0'
                  }}
                >
                  <option value="chinese">중국어 번역기</option>
                  <option value="japanese">일본어 번역기</option>
                </select>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#aab0a6' }}>프롬프트 템플릿</label>
                <select 
                  value={selectedPreset} 
                  onChange={(e) => setSelectedPreset(e.target.value)}
                  style={{
                    backgroundColor: '#0e100e', border: '1px solid #242824', borderRadius: '8px', padding: '8px', color: '#e2e4e0'
                  }}
                >
                  {Object.keys(currentPresets).map(presetId => (
                    <option key={presetId} value={presetId}>
                      {currentPresets[presetId].name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 번역 기동 버튼 */}
            <button 
              onClick={handleTranslateStart}
              disabled={isTranslating}
              style={{
                background: 'linear-gradient(135deg, #81c784, #83c5be)',
                border: 'none',
                borderRadius: '12px',
                padding: '16px',
                color: '#11111b',
                fontWeight: 'bold',
                fontSize: '15px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '10px'
              }}
            >
              {isTranslating ? (
                <>
                  <RefreshCw className="animate-spin" size={18} />
                  AI 번역 가동 중... ({transProgress}%)
                </>
              ) : (
                '번역 시작'
              )}
            </button>

            {isTranslating && (
              <button 
                onClick={() => {
                  cancelTranslationRef.current = true;
                  translationAbortControllerRef.current?.abort();
                  alert('번역이 중단되었습니다.');
                }}
                style={{
                  backgroundColor: '#e78284',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px',
                  color: '#11111b',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '8px'
                }}
              >
                번역 즉시 중지
              </button>
            )}
          </div>
        )}

        {/* 탭 3: 가독성 리더기 뷰어 (Viewer) */}
        {activeTab === 'viewer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative', width: '100%' }}>
            
            {/* 번역 진행률 플로팅 프로그래스 바 */}
            {isTranslating && (
              <div style={{
                position: 'sticky',
                top: '55px',
                zIndex: 5,
                backgroundColor: '#222922',
                color: '#a6d189',
                border: '1px solid #3d4f3d',
                padding: '10px 16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontWeight: 'bold',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                fontSize: '13px',
                maxWidth: '650px',
                width: 'calc(100% - 40px)',
                margin: '0 auto'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw style={{ animation: 'spin 1.2s linear infinite' }} size={16} />
                  번역 진행 중 ({transProgress}%)
                </span>
                <button 
                  onClick={() => {
                    cancelTranslationRef.current = true;
                    translationAbortControllerRef.current?.abort();
                    alert('번역이 중단되었습니다.');
                  }}
                  style={{
                    backgroundColor: '#e78284',
                    color: '#11111b',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  번역 중지
                </button>
              </div>
            )}

            {/* 뷰어 상단 헤더 & 컨트롤 영역: 중앙에 정렬하고 양옆 20px 패딩을 주어 가독성 유지 */}
            <div style={{ 
              borderBottom: '1px solid #242824', 
              paddingBottom: '12px',
              paddingLeft: '20px',
              paddingRight: '20px',
              paddingTop: '10px',
              maxWidth: '650px',
              width: '100%',
              margin: '0 auto',
              boxSizing: 'border-box'
            }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <button 
                  onClick={() => {
                    setLastTranslateSubTab('translate');
                    setActiveTab('translate');
                  }}
                  style={{ background: '#181c18', border: 'none', color: '#81c784', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                >
                  ← 주소 입력창으로
                </button>
                <button 
                  onClick={handleReportFeedback}
                  style={{ 
                    background: '#181c18', 
                    border: '1px solid #ea999c', 
                    color: '#ea999c', 
                    padding: '6px 12px', 
                    borderRadius: '6px', 
                    cursor: 'pointer', 
                    fontSize: '12px', 
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <AlertTriangle size={14} />
                  오류 제보
                </button>
                {!isTranslating && (
                  <button 
                    onClick={() => {
                      triggerTranslationFlow(inputUrl, 'viewer', activeViewerChapter, true);
                    }}
                    style={{ 
                      background: 'linear-gradient(135deg, #81c784, #83c5be)', 
                      border: 'none', 
                      color: '#11111b', 
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      cursor: 'pointer', 
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                  >
                    번역 시작
                  </button>
                )}
              </div>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#81c784' }}>{viewerTitle}</h2>
              <div style={{ display: 'flex', gap: '10px', fontSize: '12px', color: '#aab0a6', marginTop: '6px' }}>
                <span>제 {activeViewerChapter}화 감상 중</span>
              </div>
            </div>

            {/* colomo.dev 기반 리더기 커스텀 및 대조 독서 뷰어 렌더링 */}
            <div style={{ 
              fontFamily: readerSettings.fontFamily,
              color: readerSettings.fontColor,
              backgroundColor: readerSettings.bgColor,
              fontSize: `${parseInt(readerSettings.fontSize) || 17}px`,
              fontWeight: parseInt(readerSettings.fontWeight) || 400,
              lineHeight: parseFloat(readerSettings.lineHeight) || 1.8,
              paddingLeft: `${readerSettings.paddingX !== '' ? readerSettings.paddingX : 0}px`,
              paddingRight: `${readerSettings.paddingX !== '' ? readerSettings.paddingX : 0}px`,
              paddingTop: '20px',
              paddingBottom: readerSettings.bottomSpacing ? '100px' : '20px',
              borderRadius: 0,
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: `${parseInt(readerSettings.paragraphGap) || 20}px`,
              width: '100%',
              boxSizing: 'border-box'
            }}>
              {viewerParagraphs
                .filter(p => p.translated !== 'AI 번역 대기 중...' && p.translated !== 'AI 번역 가동 중...')
                .map((p, idx) => {
                  const showOriginal = readerSettings.keepOriginalText && p.original && (readerSettings.opacity > 0 || clickedOriginals[idx]);
                  return (
                    <div 
                      key={idx} 
                      onClick={() => handleParagraphClick(idx)}
                      style={{ 
                        textIndent: `${readerSettings.textIndent}em`,
                        cursor: (readerSettings.keepOriginalText && readerSettings.opacity === 0) ? 'pointer' : 'default'
                      }}
                    >
                      {/* 번역문 출력 */}
                      <p style={{ margin: 0, color: readerSettings.fontColor }}>{p.translated}</p>
                      
                      {/* 원문 출력 (35단계 핵심: 투명도 0일 때 숨김 처리 및 개별 클릭 탭 오픈 지원) */}
                      {showOriginal && (
                        <p style={{ 
                          margin: '6px 0 0 0', 
                          color: readerSettings.fontColor, 
                          fontSize: '0.85em', 
                          opacity: readerSettings.opacity === 0 ? 0.5 : (readerSettings.opacity / 100)
                        }}>
                          {p.original}
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* 소설 네비게이션 버튼 그룹 (이전화, 목차, 다음화) (18단계 핵심) */}
            {(viewerPrevUrl || viewerNextUrl || viewerIndexUrl) && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '12px',
                marginTop: '24px',
                marginBottom: '40px',
                paddingTop: '20px',
                borderTop: '1px solid #242824',
                maxWidth: '650px',
                width: '100%',
                margin: '24px auto 40px auto',
                boxSizing: 'border-box',
                paddingLeft: '20px',
                paddingRight: '20px'
              }}>
                {viewerPrevUrl && (
                  <button 
                    onClick={() => handleNavigateEpisode(viewerPrevUrl)}
                    style={{
                      backgroundColor: '#252630',
                      color: '#e2e4ed',
                      border: '1px solid #2d2d2d',
                      borderRadius: '8px',
                      padding: '10px 18px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'background 0.2s'
                    }}
                  >
                    이전화
                  </button>
                )}
                {viewerIndexUrl && (
                  <button 
                    onClick={() => handleNavigateEpisode(viewerIndexUrl)}
                    style={{
                      backgroundColor: '#252630',
                      color: '#e5c07b',
                      border: '1px solid #2d2d2d',
                      borderRadius: '8px',
                      padding: '10px 18px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'background 0.2s'
                    }}
                  >
                    목차
                  </button>
                )}
                {viewerNextUrl && (
                  <button 
                    onClick={() => handleNavigateEpisode(viewerNextUrl)}
                    style={{
                      backgroundColor: '#252630',
                      color: '#e2e4ed',
                      border: '1px solid #2d2d2d',
                      borderRadius: '8px',
                      padding: '10px 18px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'background 0.2s'
                    }}
                  >
                    다음화
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 탭 4: 목록 번역 결과 렌더링 (PageResult) — 36단계: 여백 없이 풀스크린 개편 */}
        {activeTab === 'pageResult' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)' }}>
            {/* 상단 미니 헤더 바 */}
            <div style={{ 
              padding: '6px 12px', 
              display: 'flex', 
              gap: '8px', 
              alignItems: 'center',
              backgroundColor: '#111311',
              borderBottom: '1px solid #222822',
              flexShrink: 0
            }}>
              <button 
                onClick={() => setActiveTab('translate')}
                style={{ background: '#252630', border: 'none', color: '#e2e4ed', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                ← 번역창
              </button>
              {/* 번역 완료 상태 표시 */}
              {!isTranslating && (
                <span style={{ fontSize: '12px', color: '#a6d189' }}>✓ 번역 완료</span>
              )}
              {/* 번역 중 진행률 + 중지 버튼 */}
              {isTranslating && (
                <>
                  <span style={{ fontSize: '11px', color: '#ca9ee6' }}>🔄 번역 중... ({transProgress}%)</span>
                  <button
                    onClick={() => {
                      cancelTranslationRef.current = true;
                      translationAbortControllerRef.current?.abort();
                    }}
                    style={{ background: '#e78284', border: 'none', color: '#11111b', padding: '3px 8px', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginLeft: 'auto', whiteSpace: 'nowrap' }}
                  >
                    중지
                  </button>
                </>
              )}
              {/* 재번역 버튼 (번역 완료 후에만 표시) */}
              {!isTranslating && novelHtmlResult && (
                <button
                  onClick={() => triggerTranslationFlow(inputUrl, 'page', null, true)}
                  style={{ background: '#222822', border: '1px solid #81c784', color: '#81c784', padding: '3px 8px', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', marginLeft: 'auto', whiteSpace: 'nowrap' }}
                >
                  재번역
                </button>
              )}
            </div>
            {/* iframe — 여백 없이 풀스크린 */}
            <iframe 
              srcDoc={novelHtmlResult}
              title="Page Translation Result"
              onLoad={handleIframeLoad}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
                backgroundColor: '#ffffff',
                width: '100%',
                display: 'block'
              }}
            />
          </div>
        )}

        {/* 탭 5: 설정 & 프롬프트/테마 커스텀 대시보드 (Settings/Presets) */}
        {activeTab === 'presets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>번역 설정 및 커스터마이징</h3>

            {/* 구글 API Key 및 모델 설정 */}
            <div style={{ backgroundColor: '#121212', padding: '16px', borderRadius: '14px', border: '1px solid #252630', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#babbf1' }}>🔑 API & AI 모델 세팅</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a5adce' }}>구글 API Key 목록 (줄바꿈 구분)</label>
                <textarea 
                  rows={2}
                  value={apiKeysInput}
                  onChange={(e) => setApiKeysInput(e.target.value)}
                  placeholder="API Key를 엔터로 구분하여 입력하세요."
                  style={{
                    backgroundColor: '#252630', border: 'none', borderRadius: '8px', padding: '10px', color: '#e2e4ed', fontFamily: 'monospace', fontSize: '12px'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a5adce' }}>사용할 AI 모델</label>
                <select 
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    backgroundColor: '#252630', border: 'none', borderRadius: '8px', padding: '10px', color: '#e2e4ed', fontSize: '13px'
                  }}
                >
                  {availableModels.map(model => (
                    <option key={model} value={model}>
                      {model} {model === 'gemini-3.1-flash-lite' ? '(최신 무료권장)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              
              <button 
                onClick={handleSaveSettings}
                style={{
                  backgroundColor: '#81c784', border: 'none', borderRadius: '8px', padding: '10px', color: '#11111b', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                }}
              >
                API/모델 설정 저장
              </button>
            </div>

            {/* 프롬프트 1 (Base Prompt) */}
            <div style={{ backgroundColor: '#111311', padding: '16px', borderRadius: '14px', border: '1px solid #222822', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#e5c07b' }}>🌐 1. 기본 언어 번역기 지침 (프롬프트 1)</h4>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setSelectedLang('chinese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'chinese' ? '#e5c07b' : '#252630',
                    color: selectedLang === 'chinese' ? '#11111b' : '#e2e4ed',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  중국어 기본지침
                </button>
                <button 
                  onClick={() => setSelectedLang('japanese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'japanese' ? '#e5c07b' : '#252630',
                    color: selectedLang === 'japanese' ? '#11111b' : '#e2e4ed',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  일본어 기본지침
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#a5adce' }}>
                  {selectedLang === 'chinese' ? '중국어' : '일본어'} 번역의 기둥이 되는 시스템 지침입니다.
                </label>
                <textarea 
                  rows={6}
                  value={basePrompts[selectedLang]}
                  onChange={(e) => handleUpdateBasePrompt(selectedLang, e.target.value)}
                  placeholder="언어별 기본 번역 지시 규칙을 입력하세요."
                  style={{
                    backgroundColor: '#222822', border: 'none', borderRadius: '8px', padding: '10px', color: '#e2e4ed', fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.5'
                  }}
                />
                <span style={{ fontSize: '11px', color: '#e5c07b', textAlign: 'right' }}>* 입력 즉시 임시 자동 저장됩니다.</span>
              </div>
            </div>

            {/* 프롬프트 2 (Sub Preset) */}
            <div style={{ backgroundColor: '#111311', padding: '16px', borderRadius: '14px', border: '1px solid #222822', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#83c5be' }}>📝 2. 작품별 추가 지침 프리셋 (프롬프트 2)</h4>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setSelectedLang('chinese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'chinese' ? '#83c5be' : '#222822',
                    color: selectedLang === 'chinese' ? '#11111b' : '#e2e4ed',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  중국어 커스텀
                </button>
                <button 
                  onClick={() => setSelectedLang('japanese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'japanese' ? '#83c5be' : '#222822',
                    color: selectedLang === 'japanese' ? '#11111b' : '#e2e4ed',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  일본어 커스텀
                </button>
              </div>

              {/* 현재 등록된 프리셋 리스트 - 클릭 시 하단 폼에 내용 로드 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a5adce' }}>현재 등록된 추가 프리셋 (클릭하면 수정)</label>
                {Object.keys(currentPresets).map(presetId => (
                  <div
                    key={presetId}
                    onClick={() => handleLoadPresetToForm(presetId)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      backgroundColor: editingPresetId === presetId ? '#1a2a1a' : '#222822',
                      border: editingPresetId === presetId ? '1px solid #81c784' : '1px solid transparent',
                      borderRadius: '8px', padding: '8px 12px',
                      cursor: presetId !== 'default' ? 'pointer' : 'default'
                    }}
                  >
                    <span style={{ fontSize: '13px', flex: 1, color: editingPresetId === presetId ? '#81c784' : '#e2e4ed' }}>
                      {currentPresets[presetId].name}
                    </span>
                    {presetId !== 'default' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePreset(presetId); }}
                        style={{ background: 'none', border: 'none', color: '#e78284', cursor: 'pointer', fontSize: '11px', padding: '2px 6px' }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* 신규 등록 / 수정 폼 */}
              <div style={{ borderTop: '1px solid #222822', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: editingPresetId ? '#81c784' : '#a5adce' }}>
                  {editingPresetId ? '프리셋 수정 중 — 이름/내용 변경 후 저장' : '새 지침 추가'}
                </label>
                <input
                  type="text" placeholder="예: 코난 덕질용 번역체"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  style={{
                    backgroundColor: '#222822',
                    border: editingPresetId ? '1px solid #81c784' : 'none',
                    borderRadius: '6px', padding: '8px', color: '#e2e4ed', fontSize: '12px'
                  }}
                />
                <textarea
                  rows={3}
                  placeholder="특정 작품 고유명사 매핑 규칙을 한글/영어로 작성하세요. (예: 江户川柯南 -> 코난)"
                  value={newPresetContent}
                  onChange={(e) => setNewPresetContent(e.target.value)}
                  style={{
                    backgroundColor: '#222822',
                    border: editingPresetId ? '1px solid #81c784' : 'none',
                    borderRadius: '6px', padding: '8px', color: '#e2e4ed', fontSize: '12px'
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  {editingPresetId && (
                    <button
                      onClick={() => { setEditingPresetId(null); setNewPresetName(''); setNewPresetContent(''); }}
                      style={{ flex: 1, backgroundColor: '#333', border: 'none', borderRadius: '8px', padding: '10px', color: '#e2e4ed', fontWeight: 'bold', cursor: 'pointer', fontSize: '12px' }}
                    >
                      취소
                    </button>
                  )}
                  <button
                    onClick={handleAddCustomPreset}
                    style={{
                      flex: 2, backgroundColor: '#83c5be', border: 'none', borderRadius: '8px', padding: '10px', color: '#11111b', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                    }}
                  >
                    {editingPresetId ? '수정 저장' : '지침 프리셋 등록'}
                  </button>
                </div>
              </div>
            </div>


            {/* colomo.dev 연동 리더기 커스텀 대시보드 */}
            
            {/* 아코디언 1: 테마 설정 */}
            <div style={{ backgroundColor: '#111311', borderRadius: '14px', border: '1px solid #222822', overflow: 'hidden' }}>
              <div 
                onClick={() => setShowThemeCollapse(!showThemeCollapse)}
                style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: showThemeCollapse ? '1px solid #222822' : 'none' }}
              >
                <h4 style={{ margin: 0, fontSize: '14px', color: '#a6d189', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ▼ 테마 설정
                </h4>
                {showThemeCollapse ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              
              {showThemeCollapse && (
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                  
                  {/* 인풋 스타일 컨트롤 Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a5adce' }}>폰트 종류 (css)</label>
                      <input 
                        type="text" value={readerSettings.fontFamily} 
                        onChange={(e) => handleUpdateReaderSetting('fontFamily', e.target.value)}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a5adce' }}>글자 색상</label>
                      <input 
                        type="text" value={readerSettings.fontColor} 
                        onChange={(e) => handleUpdateReaderSetting('fontColor', e.target.value)}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a5adce' }}>배경 색상</label>
                      <input 
                        type="text" value={readerSettings.bgColor} 
                        onChange={(e) => handleUpdateReaderSetting('bgColor', e.target.value)}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>글자 크기 (px)</label>
                      <input 
                        type="number" value={readerSettings.fontSize} 
                        onChange={(e) => handleUpdateReaderSetting('fontSize', e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>글자 두께 (weight)</label>
                      <input 
                        type="number" step="100" min="100" max="900" value={readerSettings.fontWeight} 
                        onChange={(e) => handleUpdateReaderSetting('fontWeight', e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>좌우 간격 (px)</label>
                      <input 
                        type="number" value={readerSettings.paddingX} 
                        onChange={(e) => handleUpdateReaderSetting('paddingX', e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>줄간격 (line-height)</label>
                      <input 
                        type="number" step="0.1" value={readerSettings.lineHeight} 
                        onChange={(e) => handleUpdateReaderSetting('lineHeight', e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>문장 간격 (margin, px)</label>
                      <input 
                        type="number" value={readerSettings.paragraphGap} 
                        onChange={(e) => handleUpdateReaderSetting('paragraphGap', e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>들여쓰기 (em)</label>
                      <input 
                        type="number" step="0.5" value={readerSettings.textIndent} 
                        onChange={(e) => handleUpdateReaderSetting('textIndent', e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#aab0a6' }}>원문 투명도 (0~100 %)</label>
                      <input 
                        type="number" min="0" max="100" value={readerSettings.opacity} 
                        onChange={(e) => {
                          const valStr = e.target.value;
                          if (valStr === '') {
                            handleUpdateReaderSetting('opacity', '');
                          } else {
                            let val = parseInt(valStr);
                            if (isNaN(val)) val = 0;
                            if (val < 0) val = 0;
                            if (val > 100) val = 100;
                            handleUpdateReaderSetting('opacity', val);
                          }
                        }}
                        style={{ backgroundColor: '#222822', border: 'none', borderRadius: '6px', padding: '6px', color: '#e2e4ed', fontSize: '13px' }}
                      />
                    </div>
                  </div>

                  {/* 테마 스위치들 */}
                  <div style={{ borderTop: '1px solid #222822', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>한자/일본어 병기 유지</span>
                      <input 
                        type="checkbox" checked={readerSettings.keepOriginalText} 
                        onChange={(e) => handleUpdateReaderSetting('keepOriginalText', e.target.checked)}
                        style={{ width: '18px', height: '18px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>사이트 최하단 여백 추가 (스크롤 마진)</span>
                      <input 
                        type="checkbox" checked={readerSettings.bottomSpacing} 
                        onChange={(e) => handleUpdateReaderSetting('bottomSpacing', e.target.checked)}
                        style={{ width: '18px', height: '18px' }}
                      />
                    </div>
                  </div>

                </div>
              )}
            </div>

            {/* 아코디언 2: 기타 설정 */}
            <div style={{ backgroundColor: '#121212', borderRadius: '14px', border: '1px solid #252630', overflow: 'hidden' }}>
              <div 
                onClick={() => setShowMiscCollapse(!showMiscCollapse)}
                style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: showMiscCollapse ? '1px solid #252630' : 'none' }}
              >
                <h4 style={{ margin: 0, fontSize: '14px', color: '#e5c07b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ▼ 기타 설정
                </h4>
                {showMiscCollapse ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              
              {showMiscCollapse && (
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>제목 제거</span>
                    <input 
                      type="checkbox" checked={readerSettings.removeTitle} 
                      onChange={(e) => handleUpdateReaderSetting('removeTitle', e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>원문의 개행(줄바꿈) 제거</span>
                    <input 
                      type="checkbox" checked={readerSettings.removeOriginalNewlines} 
                      onChange={(e) => handleUpdateReaderSetting('removeOriginalNewlines', e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>다운로드 시 HTML 잔여 태그 제거</span>
                    <input 
                      type="checkbox" checked={readerSettings.removeHtmlOnDownload} 
                      onChange={(e) => handleUpdateReaderSetting('removeHtmlOnDownload', e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>빈 줄 강제 제거</span>
                    <input 
                      type="checkbox" checked={readerSettings.removeEmptyLines} 
                      onChange={(e) => handleUpdateReaderSetting('removeEmptyLines', e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>원문에 구글 번역/발음 부가정보 추가</span>
                    <input 
                      type="checkbox" checked={readerSettings.googleTranslate} 
                      onChange={(e) => handleUpdateReaderSetting('googleTranslate', e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 보관함 통계 및 클리너 */}
            <div style={{ backgroundColor: '#121212', padding: '16px', borderRadius: '14px', border: '1px solid #252630', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#e78284' }}>💾 보관함 캐시 용량 최적화</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#bac2de' }}>
                <div>보관 소설 수: {cacheStats.totalNovels}개</div>
                <div>캐시된 화수: {cacheStats.totalCachedEpisodes}개</div>
              </div>
              <button 
                onClick={handleClearCache}
                style={{
                  backgroundColor: '#252630', border: 'none', color: '#e78284', borderRadius: '8px', padding: '10px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '4px'
                }}
              >
                오래된 캐시 일괄 삭제 (최근 30일 미열람 분량)
              </button>
            </div>

          </div>
        )}

      </main>

      {/* 하단 네비게이션 */}
      <footer style={{
        display: 'flex',
        borderTop: '1px solid #222822',
        backgroundColor: '#111311',
        padding: '10px 0',
        position: 'sticky',
        bottom: 0,
        zIndex: 10
      }}>
        {[
          { id: 'library', label: '보관함', icon: FolderHeart },
          { id: 'translate', label: '실시간번역', icon: BookOpen },
          { id: 'presets', label: '번역 설정', icon: Star }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id || (tab.id === 'translate' && (activeTab === 'viewer' || activeTab === 'pageResult'));
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'translate') {
                  setActiveTab(lastTranslateSubTab);
                } else {
                  setActiveTab(tab.id);
                }
              }}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                color: isActive ? '#81c784' : '#a5adce',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: isActive ? 'bold' : 'normal'
              }}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </footer>
    </div>
  );
}

export default App;
