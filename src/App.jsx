import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings, FolderHeart, Star, Trash2, Plus, Download, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { openDB, saveNovel, getNovels, deleteNovel, saveEpisode, getEpisode, clearOldEpisodes, getCacheStatistics } from './db.js';
import { getApiKeys, saveApiKeys, getActiveApiKey, fetchAvailableModels } from './apiRotator.js';
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
- 배경이 무협/선협/대체역사 장르 of 소설이라면, 중국어 고유명사는 무조건 한국 한자음으로 씁니다. (예: 北京 -> 북경 / 上海 -> 상해 / 北冥神功 -> 북명신공)`,
  japanese: `You are a professional literary translator specializing in translating Japanese light novels and web novels into natural and engaging Korean. Follow these instructions:

1. Translate into fluent Korean light novel style. Avoid direct translation of Japanese grammar style (e.g., '~의 경우', '~에 있어서' 같은 직역 지양).
2. Translate dialogues naturally based on character relationships and personality.
3. Return only the Korean translation.
4. Keep the character names consistent in official Korean localizations.`
};

// 리더기 테마 및 스타일 기본값 정의
const DEFAULT_READER_SETTINGS = {
  fontFamily: 'system-ui',
  fontColor: '#cdd6f4',
  bgColor: '#1e1e2e',
  opacity: 40,
  fontSize: 16,
  fontWeight: 400,
  paddingX: 20,
  lineHeight: 1.8,
  paragraphGap: 12,
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

  // 프롬프트 직접 추가 폼 상태
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetContent, setNewPresetContent] = useState('');

  // 리더기 상세 커스텀 설정 상태
  const [readerSettings, setReaderSettings] = useState(() => {
    const cached = localStorage.getItem('noveltrans_reader_settings');
    return cached ? JSON.parse(cached) : DEFAULT_READER_SETTINGS;
  });
  
  // 아코디언 접기/열기 상태
  const [showThemeCollapse, setShowThemeCollapse] = useState(true);
  const [showMiscCollapse, setShowMiscCollapse] = useState(true);

  // 번역 입력 상태
  const [inputUrl, setInputUrl] = useState('');
  const [transMode, setTransMode] = useState('viewer'); // 'page' (목록 번역) or 'viewer' (본문 뷰어)
  const [transProgress, setTransProgress] = useState(0);
  const [isTranslating, setIsTranslating] = useState(false);

  // 뷰어 및 렌더링 상태
  const [viewerTitle, setViewerTitle] = useState('');
  const [viewerParagraphs, setViewerParagraphs] = useState([]); // [{ original, translated }]
  const [novelHtmlResult, setNovelHtmlResult] = useState(''); // 목록 번역 html 결과
  const [activeViewerNovelId, setActiveViewerNovelId] = useState(null);
  const [activeViewerChapter, setActiveViewerChapter] = useState(1);

  // 최신 inputUrl 값을 참조하기 위한 ref (iframe 비동기 핸들러용)
  const inputUrlRef = useRef(inputUrl);
  useEffect(() => {
    inputUrlRef.current = inputUrl;
  }, [inputUrl]);

  // 1. 초기 로드 및 모델 목록 캐시 동기화
  useEffect(() => {
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
      } finally {
        setIsLoading(false);
      }
    }
    init();
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

  // URL 입력 변경 시 화수 자동 감지 동기화
  const handleUrlChange = (e) => {
    const url = e.target.value;
    setInputUrl(url);
    if (transMode === 'viewer') {
      const detectedChapter = detectChapterFromUrl(url);
      setActiveViewerChapter(detectedChapter);
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

  // 신규 프롬프트 프리셋 직접 추가 기능
  const handleAddCustomPreset = () => {
    if (!newPresetName || !newPresetContent) {
      return alert('프리셋 이름과 프롬프트 본문을 입력해 주세요.');
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
    }
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
    }
  };

  // 실시간 번역 공통 구동 코어 함수
  const triggerTranslationFlow = async (targetUrl, targetMode, forceChapter = null) => {
    const activeKey = getActiveApiKey();
    if (!activeKey) {
      alert('API Key를 먼저 설정에서 1개 이상 등록해 주세요.');
      setActiveTab('presets');
      return;
    }

    setIsTranslating(true);
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

        setTransProgress(40);
        const translatedHtml = await translateFullPage(data.html, finalSystemPrompt, selectedModel, (progress) => {
          setTransProgress(40 + Math.round(progress * 0.6));
        });
        setNovelHtmlResult(translatedHtml);
        setActiveTab('pageResult');
      } else {
        // [본문 뷰어 모드 - colomo.dev 스타일 실시간 스트리밍 출력 이식]
        const { title, paragraphs } = extractNovelContent(data.html, targetUrl);
        setViewerTitle(title);
        
        // 보관함 DB 등록 및 화수 업데이트
        const novelId = await saveNovel({
          title,
          url: targetUrl,
          site: siteName,
          lastReadChapter: chapterToUse
        });
        setActiveViewerNovelId(novelId);

        // 캐시 조회
        const cached = await getEpisode(novelId, chapterToUse);
        if (cached) {
          const parsedLines = JSON.parse(cached.translatedText);
          const origLines = JSON.parse(cached.originalText || '[]');
          const formatted = parsedLines.map((t, i) => ({ translated: t, original: origLines[i] || '' }));
          setViewerParagraphs(formatted);
          setTransProgress(100);
          setActiveTab('viewer');
        } else {
          // 캐시가 없을 시, 즉시 리더기 탭(viewer)으로 넘어가서 원문을 먼저 채우고 대기 (실시간 한 줄씩 뿅뿅 뜨게 유도)
          const initialViewerLines = paragraphs.map(p => ({ original: p, translated: 'AI 번역 대기 중...' }));
          setViewerParagraphs(initialViewerLines);
          setActiveTab('viewer'); // 대기 화면을 보여주지 않고 즉시 리더기로 휙 이동!

          const translatedList = [];
          const fullOriginalText = paragraphs.join('\n');
          const activeSubPrompt = filterActiveGlossary(rawSubPrompt, fullOriginalText);
          
          const finalSystemPrompt = activeSubPrompt 
            ? `${basePrompt}\n\n[추가 특정 작품/용어 사전 지침]\n${activeSubPrompt}` 
            : basePrompt;

          for (let i = 0; i < paragraphs.length; i++) {
            const orig = paragraphs[i];
            
            // 뷰어 화면 개별 문단에 임시로 '번역 중...' 상태 노출
            setViewerParagraphs(prev => {
              const next = [...prev];
              next[i] = { original: orig, translated: 'AI 번역 가동 중...' };
              return next;
            });

            // 해당 단락 1개 번역 실행
            const trans = await translateTextWithRotation(orig, finalSystemPrompt, selectedModel);
            translatedList.push(trans);

            // 번역 완료 즉시 뷰어 화면의 개별 문단을 실시간 한글로 뿅 업데이트! (스트리밍 경험 제공)
            setViewerParagraphs(prev => {
              const next = [...prev];
              next[i] = { original: orig, translated: trans };
              return next;
            });

            // 진행률 표시
            setTransProgress(Math.round(((i + 1) / paragraphs.length) * 100));
          }

          // 전체 번역이 마쳐진 후 DB 캐시에 영구 적재
          await saveEpisode(novelId, chapterToUse, JSON.stringify(translatedList), JSON.stringify(paragraphs));
        }
        
        getNovels().then(setNovels);
      }
    } catch (err) {
      alert('번역 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsTranslating(false);
      getCacheStatistics().then(setCacheStats);
    }
  };

  // 수동 번역 시작 버튼 트리거
  const handleTranslateStart = () => {
    triggerTranslationFlow(inputUrl, transMode);
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

  const handleLoadNovel = (novel) => {
    setInputUrl(novel.url);
    setActiveViewerNovelId(novel.id);
    setActiveViewerChapter(novel.lastReadChapter || 1);
    setTransMode('viewer');
    setActiveTab('translate');
  };

  const handleClearCache = async () => {
    if (window.confirm('최근 30일 동안 읽지 않은 모든 번역 캐시 데이터를 소거하시겠습니까?')) {
      await clearOldEpisodes(30);
      alert('캐시 정리가 완료되었습니다.');
      getCacheStatistics().then(setCacheStats);
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
        backgroundColor: '#1e1e2e',
        color: '#cdd6f4',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          border: '4px solid #313244',
          borderTop: '4px solid #89b4fa',
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          animation: 'spin 1s linear infinite',
          marginBottom: '16px'
        }} />
        <span style={{ fontSize: '14px', color: '#a6adc8' }}>로컬 데이터베이스 연결 중...</span>
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
      backgroundColor: '#1e1e2e',
      color: '#cdd6f4',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* 헤더 */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1px solid #313244',
        backgroundColor: '#181825',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #89b4fa, #cba6f7)',
            padding: '8px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <BookOpen size={24} color="#11111b" />
          </div>
          <span style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '-0.5px' }}>
            Novel<span style={{ color: '#89b4fa' }}>Trans</span>
          </span>
        </div>
      </header>

      {/* 본문 콘텐츠 */}
      <main style={{ flex: 1, padding: '20px', maxWidth: '650px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        
        {/* 탭 1: 보관함 (Library) */}
        {activeTab === 'library' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>내 소설 보관함</h3>
            
            {novels.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '50px 20px',
                border: '2px dashed #313244',
                borderRadius: '16px',
                color: '#a6adc8'
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
                    backgroundColor: '#181825',
                    border: '1px solid #313244',
                    borderRadius: '16px',
                    padding: '16px',
                    gap: '16px',
                    cursor: 'pointer',
                    transition: 'transform 0.15s'
                  }}
                >
                  <div style={{ backgroundColor: '#313244', padding: '10px', borderRadius: '12px' }}>
                    <FolderHeart size={22} color="#f38ba8" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {novel.title}
                    </h4>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
                      <span style={{ backgroundColor: '#313244', padding: '2px 6px', borderRadius: '4px', color: '#89b4fa' }}>{novel.site}</span>
                      <span style={{ color: '#a6adc8' }}>마지막 화: {novel.lastReadChapter}화</span>
                    </div>
                  </div>
                  
                  {/* 조작 버튼 영역 */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={(e) => handleDownload(novel, e)}
                      style={{ background: 'none', border: 'none', color: '#a6e3a1', padding: '6px', cursor: 'pointer' }}
                      title="텍스트 파일 다운로드"
                    >
                      <Download size={18} />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteNovel(novel.id, novel.title, e)}
                      style={{ background: 'none', border: 'none', color: '#f38ba8', padding: '6px', cursor: 'pointer' }}
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
              <label style={{ fontSize: '13px', color: '#a6adc8' }}>소설 주소 (URL)</label>
              <input 
                type="text" 
                placeholder="예: https://www.52shuku.net/bl/..." 
                value={inputUrl}
                onChange={handleUrlChange}
                style={{
                  backgroundColor: '#181825',
                  border: '1px solid #313244',
                  borderRadius: '10px',
                  padding: '12px',
                  color: '#cdd6f4',
                  fontSize: '14px'
                }}
              />
            </div>

            {/* 번역 옵션 그룹 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>번역 모드 (언어 선택)</label>
                <select 
                  value={selectedLang} 
                  onChange={(e) => {
                    setSelectedLang(e.target.value);
                    setSelectedPreset('default');
                  }}
                  style={{
                    backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '8px', color: '#cdd6f4'
                  }}
                >
                  <option value="chinese">중국어 번역기</option>
                  <option value="japanese">일본어 번역기</option>
                </select>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>프롬프트 템플릿</label>
                <select 
                  value={selectedPreset} 
                  onChange={(e) => setSelectedPreset(e.target.value)}
                  style={{
                    backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '8px', color: '#cdd6f4'
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#a6adc8' }}>출력 모드 (뷰어 형태)</label>
              <select 
                value={transMode} 
                onChange={(e) => setTransMode(e.target.value)}
                style={{
                  backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '8px', color: '#cdd6f4'
                }}
              >
                <option value="viewer">본문 리더기 (소설독서용)</option>
                <option value="page">목록/웹페이지 번역 (원본보존용)</option>
              </select>
            </div>

            {/* 수동 화수 선택창 제거 완료 (유저 피드백 반영: 완전 자동감지형 미니멀리즘 인터페이스) */}

            {/* 번역 기동 버튼 */}
            <button 
              onClick={handleTranslateStart}
              disabled={isTranslating}
              style={{
                background: 'linear-gradient(135deg, #89b4fa, #cba6f7)',
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
                gap: '8px'
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
          </div>
        )}

        {/* 탭 3: 가독성 리더기 뷰어 (Viewer) */}
        {activeTab === 'viewer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
            
            {/* 번역 진행률 플로팅 프로그래스 바 (colomo.dev와 동일하게 뷰어 상태에서 실시간 전하량 렌더링) */}
            {isTranslating && (
              <div style={{
                position: 'sticky',
                top: '55px',
                zIndex: 5,
                backgroundColor: '#a6e3a1',
                color: '#11111b',
                padding: '10px 16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontWeight: 'bold',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                fontSize: '13px',
                animation: 'pulse 1.5s infinite'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw style={{ animation: 'spin 1.2s linear infinite' }} size={16} />
                  실시간 백그라운드 번역 진행 중...
                </span>
                <span>{transProgress}% 완료</span>
                <style>{`
                  @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.02); }
                    100% { transform: scale(1); }
                  }
                `}</style>
              </div>
            )}

            <div style={{ borderBottom: '1px solid #313244', paddingBottom: '12px' }}>
              <button 
                onClick={() => setActiveTab('library')}
                style={{ background: '#313244', border: 'none', color: '#cdd6f4', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', marginBottom: '8px' }}
              >
                ← 보관함으로
              </button>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#89b4fa' }}>{viewerTitle}</h2>
              <div style={{ display: 'flex', gap: '10px', fontSize: '12px', color: '#a6adc8', marginTop: '6px' }}>
                <span>제 {activeViewerChapter}화 감상 중</span>
              </div>
            </div>

            {/* colomo.dev 기반 리더기 커스텀 및 대조 독서 뷰어 렌더링 */}
            <div style={{ 
              fontFamily: readerSettings.fontFamily,
              color: readerSettings.fontColor,
              backgroundColor: readerSettings.bgColor,
              fontSize: `${readerSettings.fontSize}px`,
              fontWeight: readerSettings.fontWeight,
              lineHeight: readerSettings.lineHeight,
              paddingLeft: `${readerSettings.paddingX}px`,
              paddingRight: `${readerSettings.paddingX}px`,
              paddingTop: '20px',
              paddingBottom: readerSettings.bottomSpacing ? '100px' : '20px',
              borderRadius: '16px',
              border: '1px solid #313244',
              display: 'flex',
              flexDirection: 'column',
              gap: `${readerSettings.paragraphGap}px`
            }}>
              {viewerParagraphs.map((p, idx) => (
                <div key={idx} style={{ 
                  textIndent: `${readerSettings.textIndent}em`,
                  borderBottom: '1px solid rgba(49, 50, 68, 0.3)', 
                  paddingBottom: '12px' 
                }}>
                  {/* 번역문 출력 */}
                  <p style={{ margin: 0, color: readerSettings.fontColor }}>{p.translated}</p>
                  
                  {/* 원문 출력 (한자/일본어 병기 유지 스위치가 켜진 경우에만 렌더링) */}
                  {readerSettings.keepOriginalText && p.original && (
                    <p style={{ 
                      margin: '6px 0 0 0', 
                      color: readerSettings.fontColor, 
                      fontSize: '0.85em', 
                      opacity: readerSettings.opacity / 100 
                    }}>
                      {p.original}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 탭 4: 목록 번역 결과 렌더링 (PageResult) */}
        {activeTab === 'pageResult' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
            <div style={{ padding: '8px 0', display: 'flex', gap: '10px' }}>
              <button 
                onClick={() => setActiveTab('translate')}
                style={{ background: '#313244', border: 'none', color: '#cdd6f4', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
              >
                ← 번역창으로
              </button>
              <span style={{ fontSize: '13px', color: '#a6e3a1', display: 'flex', alignItems: 'center' }}>✓ 목록 번역 완료 (레이아웃 보존)</span>
              {isTranslating && <span style={{ fontSize: '12px', color: '#cba6f7', marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>🔄 신규 페이지 백그라운드 번역 중... ({transProgress}%)</span>}
            </div>
            <iframe 
              srcDoc={novelHtmlResult}
              title="Page Translation Result"
              onLoad={handleIframeLoad}
              style={{
                flex: 1,
                border: '1px solid #313244',
                borderRadius: '12px',
                backgroundColor: '#ffffff',
                width: '100%'
              }}
            />
          </div>
        )}

        {/* 탭 5: 설정 & 프롬프트/테마 커스텀 대시보드 (Settings/Presets) */}
        {activeTab === 'presets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>번역 설정 및 커스터마이징</h3>

            {/* 구글 API Key 및 모델 설정 */}
            <div style={{ backgroundColor: '#181825', padding: '16px', borderRadius: '14px', border: '1px solid #313244', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#89b4fa' }}>🔑 API & AI 모델 세팅</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>구글 API Key 목록 (줄바꿈 구분)</label>
                <textarea 
                  rows={2}
                  value={apiKeysInput}
                  onChange={(e) => setApiKeysInput(e.target.value)}
                  placeholder="API Key를 엔터로 구분하여 입력하세요."
                  style={{
                    backgroundColor: '#313244', border: 'none', borderRadius: '8px', padding: '10px', color: '#cdd6f4', fontFamily: 'monospace', fontSize: '12px'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>사용할 AI 모델</label>
                <select 
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    backgroundColor: '#313244', border: 'none', borderRadius: '8px', padding: '10px', color: '#cdd6f4', fontSize: '13px'
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
                  backgroundColor: '#89b4fa', border: 'none', borderRadius: '8px', padding: '10px', color: '#11111b', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                }}
              >
                API/모델 설정 저장
              </button>
            </div>

            {/* 프롬프트 1 (Base Prompt): 언어별 기본 번역기 프롬프트 설정 (비구씨 템플릿 포함) */}
            <div style={{ backgroundColor: '#181825', padding: '16px', borderRadius: '14px', border: '1px solid #313244', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#f9e2af' }}>🌐 1. 기본 언어 번역기 지침 (프롬프트 1)</h4>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setSelectedLang('chinese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'chinese' ? '#f9e2af' : '#313244',
                    color: selectedLang === 'chinese' ? '#11111b' : '#cdd6f4',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  중국어 기본지침
                </button>
                <button 
                  onClick={() => setSelectedLang('japanese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'japanese' ? '#f9e2af' : '#313244',
                    color: selectedLang === 'japanese' ? '#11111b' : '#cdd6f4',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  일본어 기본지침
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#a6adc8' }}>
                  {selectedLang === 'chinese' ? '중국어' : '일본어'} 번역의 기둥이 되는 시스템 지침입니다.
                </label>
                <textarea 
                  rows={6}
                  value={basePrompts[selectedLang]}
                  onChange={(e) => handleUpdateBasePrompt(selectedLang, e.target.value)}
                  placeholder="언어별 기본 번역 지시 규칙을 입력하세요."
                  style={{
                    backgroundColor: '#313244', border: 'none', borderRadius: '8px', padding: '10px', color: '#cdd6f4', fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.5'
                  }}
                />
                <span style={{ fontSize: '11px', color: '#f9e2af', textAlign: 'right' }}>* 입력 즉시 임시 자동 저장됩니다.</span>
              </div>
            </div>

            {/* 프롬프트 2 (Sub Preset): 프롬프트 템플릿 추가/관리 영역 */}
            <div style={{ backgroundColor: '#181825', padding: '16px', borderRadius: '14px', border: '1px solid #313244', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#cba6f7' }}>📝 2. 작품별 추가 지침 프리셋 (프롬프트 2)</h4>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setSelectedLang('chinese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'chinese' ? '#cba6f7' : '#313244',
                    color: selectedLang === 'chinese' ? '#11111b' : '#cdd6f4',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  중국어 커스텀
                </button>
                <button 
                  onClick={() => setSelectedLang('japanese')} 
                  style={{
                    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
                    backgroundColor: selectedLang === 'japanese' ? '#cba6f7' : '#313244',
                    color: selectedLang === 'japanese' ? '#11111b' : '#cdd6f4',
                    fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  일본어 커스텀
                </button>
              </div>

              {/* 현재 등록된 프리셋 리스트 목록 및 삭제 기능 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>현재 등록된 추가 프리셋</label>
                {Object.keys(currentPresets).map(presetId => (
                  <div key={presetId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#313244', padding: '8px 12px', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px' }}>{currentPresets[presetId].name}</span>
                    {presetId !== 'default' && (
                      <button 
                        onClick={() => handleDeletePreset(presetId)}
                        style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer' }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* 신규 등록 폼 */}
              <div style={{ borderTop: '1px solid #313244', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>새 추가 지침 추가</label>
                <input 
                  type="text" placeholder="예: 코난 덕질용 번역체" 
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  style={{
                    backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '8px', color: '#cdd6f4', fontSize: '12px'
                  }}
                />
                <textarea 
                  rows={3} 
                  placeholder="특정 작품 고유명사 매핑 규칙을 한글/영어로 작성하세요. (예: 江户川柯南 -> 코난)"
                  value={newPresetContent}
                  onChange={(e) => setNewPresetContent(e.target.value)}
                  style={{
                    backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '8px', color: '#cdd6f4', fontSize: '12px'
                  }}
                />
                <button 
                  onClick={handleAddCustomPreset}
                  style={{
                    backgroundColor: '#cba6f7', border: 'none', borderRadius: '8px', padding: '10px', color: '#11111b', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  추가 지침 프리셋 등록
                </button>
              </div>
            </div>

            {/* colomo.dev 연동 리더기 커스텀 대시보드 */}
            
            {/* 아코디언 1: 테마 설정 */}
            <div style={{ backgroundColor: '#181825', borderRadius: '14px', border: '1px solid #313244', overflow: 'hidden' }}>
              <div 
                onClick={() => setShowThemeCollapse(!showThemeCollapse)}
                style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: showThemeCollapse ? '1px solid #313244' : 'none' }}
              >
                <h4 style={{ margin: 0, fontSize: '14px', color: '#a6e3a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ▼ 테마 설정
                </h4>
                {showThemeCollapse ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              
              {showThemeCollapse && (
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                  
                  {/* 인풋 스타일 컨트롤 Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>폰트 종류 (css)</label>
                      <input 
                        type="text" value={readerSettings.fontFamily} 
                        onChange={(e) => handleUpdateReaderSetting('fontFamily', e.target.value)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>글자 색상</label>
                      <input 
                        type="text" value={readerSettings.fontColor} 
                        onChange={(e) => handleUpdateReaderSetting('fontColor', e.target.value)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>배경 색상</label>
                      <input 
                        type="text" value={readerSettings.bgColor} 
                        onChange={(e) => handleUpdateReaderSetting('bgColor', e.target.value)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>글자 크기 (px)</label>
                      <input 
                        type="number" value={readerSettings.fontSize} 
                        onChange={(e) => handleUpdateReaderSetting('fontSize', parseInt(e.target.value) || 16)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>글자 두께 (weight)</label>
                      <input 
                        type="number" step="100" min="100" max="900" value={readerSettings.fontWeight} 
                        onChange={(e) => handleUpdateReaderSetting('fontWeight', parseInt(e.target.value) || 400)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>좌우 간격 (px)</label>
                      <input 
                        type="number" value={readerSettings.paddingX} 
                        onChange={(e) => handleUpdateReaderSetting('paddingX', parseInt(e.target.value) || 20)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>줄간격 (line-height)</label>
                      <input 
                        type="number" step="0.1" value={readerSettings.lineHeight} 
                        onChange={(e) => handleUpdateReaderSetting('lineHeight', parseFloat(e.target.value) || 1.8)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>문장 간격 (margin, px)</label>
                      <input 
                        type="number" value={readerSettings.paragraphGap} 
                        onChange={(e) => handleUpdateReaderSetting('paragraphGap', parseInt(e.target.value) || 12)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>들여쓰기 (em)</label>
                      <input 
                        type="number" step="0.5" value={readerSettings.textIndent} 
                        onChange={(e) => handleUpdateReaderSetting('textIndent', parseFloat(e.target.value) || 0)}
                        style={{ backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#a6adc8' }}>원문 투명도 대조 (%)</label>
                      <input 
                        type="range" min="0" max="100" value={readerSettings.opacity} 
                        onChange={(e) => handleUpdateReaderSetting('opacity', parseInt(e.target.value))}
                        style={{ marginTop: '8px' }}
                      />
                    </div>
                  </div>

                  {/* 테마 스위치들 */}
                  <div style={{ borderTop: '1px solid #313244', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
            <div style={{ backgroundColor: '#181825', borderRadius: '14px', border: '1px solid #313244', overflow: 'hidden' }}>
              <div 
                onClick={() => setShowMiscCollapse(!showMiscCollapse)}
                style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: showMiscCollapse ? '1px solid #313244' : 'none' }}
              >
                <h4 style={{ margin: 0, fontSize: '14px', color: '#f9e2af', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
            <div style={{ backgroundColor: '#181825', padding: '16px', borderRadius: '14px', border: '1px solid #313244', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#f38ba8' }}>💾 보관함 캐시 용량 최적화</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#bac2de' }}>
                <div>보관 소설 수: {cacheStats.totalNovels}개</div>
                <div>캐시된 화수: {cacheStats.totalCachedEpisodes}개</div>
              </div>
              <button 
                onClick={handleClearCache}
                style={{
                  backgroundColor: '#313244', border: 'none', color: '#f38ba8', borderRadius: '8px', padding: '10px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '4px'
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
        borderTop: '1px solid #313244',
        backgroundColor: '#181825',
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
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                color: isActive ? '#89b4fa' : '#a6adc8',
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
