import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings, FolderHeart, Star, Trash2, Plus, Download, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { openDB, saveNovel, getNovels, deleteNovel, saveEpisode, getEpisode, clearOldEpisodes, getCacheStatistics } from './db.js';
import { getApiKeys, saveApiKeys, getActiveApiKey, fetchAvailableModels } from './apiRotator.js';
import { getPromptsTree, savePreset, getPromptContent } from './promptManager.js';
import { translateFullPage, extractNovelContent } from './parser.js';
import { downloadCachedEpisodes } from './downloader.js';

function App() {
  const [activeTab, setActiveTab] = useState('library');
  const [novels, setNovels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 설정 상태
  const [apiKeysInput, setApiKeysInput] = useState('');
  const [availableModels, setAvailableModels] = useState(() => {
    // 1안 스펙: 로컬스토리지 캐시 우선 로드 (없다면 유저 지적 모델 gemini-3.1-flash-lite 기본값 제공)
    const cached = localStorage.getItem('noveltrans_cached_models');
    return cached ? JSON.parse(cached) : ['gemini-3.1-flash-lite'];
  });
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-lite');
  const [promptsTree, setPromptsTree] = useState({});
  const [selectedLang, setSelectedLang] = useState('chinese');
  const [selectedPreset, setSelectedPreset] = useState('default');
  const [cacheStats, setCacheStats] = useState({ totalNovels: 0, totalCachedEpisodes: 0 });

  // 번역 입력 상태
  const [inputUrl, setInputUrl] = useState('');
  const [transMode, setTransMode] = useState('viewer'); // 'page' or 'viewer'
  const [transProgress, setTransProgress] = useState(0);
  const [isTranslating, setIsTranslating] = useState(false);

  // 뷰어 및 렌더링 상태
  const [viewerTitle, setViewerTitle] = useState('');
  const [viewerParagraphs, setViewerParagraphs] = useState([]); // [{ original, translated }]
  const [opacity, setOpacity] = useState(40); // 원문 투명도 (0% ~ 100%)
  const [fontSize, setFontSize] = useState(16);
  const [novelHtmlResult, setNovelHtmlResult] = useState(''); // 목록 번역 html 결과
  const [activeViewerNovelId, setActiveViewerNovelId] = useState(null);
  const [activeViewerChapter, setActiveViewerChapter] = useState(1);

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

        // 첫 번째 API Key를 활용하여 구글 ListModels API 백그라운드 캐시 최신화 (1안 방식)
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

  // API 호출을 통해 사용 가능한 모델 목록 갱신 및 캐싱
  const loadModels = async (key) => {
    if (!key) return;
    const fetchedList = await fetchAvailableModels(key);
    if (fetchedList && fetchedList.length > 0) {
      setAvailableModels(fetchedList);
      localStorage.setItem('noveltrans_cached_models', JSON.stringify(fetchedList));
      // 만약 기존에 선택했던 모델이 새 리스트에 없으면 첫 번째 모델로 세팅
      if (!fetchedList.includes(selectedModel)) {
        setSelectedModel(fetchedList[0]);
      }
    }
  };

  // API Key 저장 및 모델 목록 리프레시
  const handleSaveSettings = async () => {
    const keys = apiKeysInput.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    saveApiKeys(keys);
    alert('설정이 저장되었습니다. 입력하신 API Key로 최신 구글 무료 제공 모델 조회를 수행합니다.');
    
    // 저장과 동시에 모델 목록 동적 갱신 작동
    if (keys.length > 0) {
      await loadModels(keys[0]);
    }
    
    getCacheStatistics().then(setCacheStats);
  };

  // 소설 삭제
  const handleDelete = async (id, title, e) => {
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

  // 실시간 번역 시작
  const handleTranslateStart = async () => {
    if (!inputUrl) return alert('번역할 URL을 입력해 주세요.');
    const activeKey = getActiveApiKey();
    if (!activeKey) return alert('API Key를 먼저 설정에서 1개 이상 등록해 주세요.');

    setIsTranslating(true);
    setTransProgress(5);
    setNovelHtmlResult('');
    setViewerParagraphs([]);

    const systemPrompt = getPromptContent(selectedLang, selectedPreset);

    try {
      // 1. 백엔드 프록시 서버에 HTML 요청
      setTransProgress(20);
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(inputUrl)}`);
      if (!res.ok) throw new Error('CORS 프록시 서버 통신 실패');
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // 소설 보관함에 자동 등록을 위한 정보 파싱
      const tempTitle = data.html.match(/<title>(.*?)<\/title>/i)?.[1] || '번역된 소설';
      const siteName = inputUrl.includes('52shuku') ? '52shuku' : inputUrl.includes('jjwxc') ? '진강문학성' : inputUrl.includes('ao3') ? 'AO3' : '기타';

      // 2. 번역 분기 작동
      if (transMode === 'page') {
        // 목록 번역 모드 (Full Page Mode)
        setTransProgress(40);
        const translatedHtml = await translateFullPage(data.html, systemPrompt, selectedModel, (progress) => {
          setTransProgress(40 + Math.round(progress * 0.6));
        });
        setNovelHtmlResult(translatedHtml);
        setActiveTab('pageResult');
      } else {
        // 본문 뷰어 모드 (Reader Mode)
        setTransProgress(40);
        const { title, paragraphs } = extractNovelContent(data.html, inputUrl);
        setViewerTitle(title);
        
        // 보관함 DB에 소설 등록
        const novelId = await saveNovel({
          title,
          url: inputUrl,
          site: siteName,
          lastReadChapter: activeViewerChapter
        });
        setActiveViewerNovelId(novelId);

        // 이미 캐시된 내용이 있는지 확인
        const cached = await getEpisode(novelId, activeViewerChapter);
        if (cached) {
          // 캐시가 존재하면 번역 호출을 생략하고 즉시 렌더링
          const parsedLines = JSON.parse(cached.translatedText);
          const origLines = JSON.parse(cached.originalText || '[]');
          const formatted = parsedLines.map((t, i) => ({ translated: t, original: origLines[i] || '' }));
          setViewerParagraphs(formatted);
          setTransProgress(100);
          setActiveTab('viewer');
        } else {
          // 캐시가 없으면 문단별 번역 수행
          const translatedList = [];
          const combinedList = [];
          
          for (let i = 0; i < paragraphs.length; i++) {
            const orig = paragraphs[i];
            setTransProgress(40 + Math.round((i / paragraphs.length) * 55));
            const trans = await translateTextWithRotation(orig, systemPrompt, selectedModel);
            translatedList.push(trans);
            combinedList.push({ original: orig, translated: trans });
          }

          // DB 캐시에 영구 적재
          await saveEpisode(novelId, activeViewerChapter, JSON.stringify(translatedList), JSON.stringify(paragraphs));
          
          setViewerParagraphs(combinedList);
          setTransProgress(100);
          setActiveTab('viewer');
        }
        
        // 보관함 목록 갱신
        getNovels().then(setNovels);
      }
    } catch (err) {
      alert('번역 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsTranslating(false);
      getCacheStatistics().then(setCacheStats);
    }
  };

  // 보관함에서 소설 클릭 시 즉시 실시간 번역창으로 연동
  const handleLoadNovel = (novel) => {
    setInputUrl(novel.url);
    setActiveViewerNovelId(novel.id);
    setActiveViewerChapter(novel.lastReadChapter || 1);
    setTransMode('viewer');
    setActiveTab('translate');
  };

  // 캐시 일괄 클리어
  const handleClearCache = async () => {
    if (window.confirm('최근 30일 동안 읽지 않은 모든 번역 캐시 데이터를 소거하시겠습니까?')) {
      await clearOldEpisodes(30);
      alert('캐시 정리가 완료되었습니다.');
      getCacheStatistics().then(setCacheStats);
    }
  };

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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => setActiveTab('settings')}
            style={{
              background: activeTab === 'settings' ? '#313244' : 'none',
              border: 'none',
              color: activeTab === 'settings' ? '#89b4fa' : '#a6adc8',
              padding: '8px',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <Settings size={20} />
          </button>
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
                      onClick={(e) => handleDelete(novel.id, novel.title, e)}
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
                onChange={(e) => setInputUrl(e.target.value)}
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
                <label style={{ fontSize: '12px', color: '#a6adc8' }}>번역 모드</label>
                <select 
                  value={transMode} 
                  onChange={(e) => setTransMode(e.target.value)}
                  style={{
                    backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '8px', color: '#cdd6f4'
                  }}
                >
                  <option value="viewer">본문 뷰어 (소설독서용)</option>
                  <option value="page">목록 번역 (원본보존용)</option>
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
                  <option value="default">중국어 기본 소설 번역</option>
                  <option value="conan">코난 팬덤 특화 번역</option>
                  <option value="naruto">나루토 팬덤 특화 번역</option>
                </select>
              </div>
            </div>

            {/* 본문 뷰어일 시 화수 조절 */}
            {transMode === 'viewer' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#181825', padding: '12px', borderRadius: '10px', border: '1px solid #313244' }}>
                <span style={{ fontSize: '13px', color: '#a6adc8' }}>읽을 화수 설정</span>
                <input 
                  type="number" 
                  value={activeViewerChapter} 
                  onChange={(e) => setActiveViewerChapter(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{
                    width: '70px', backgroundColor: '#313244', border: 'none', borderRadius: '6px', padding: '6px', color: '#cdd6f4', textAlign: 'center'
                  }}
                />
                <span style={{ fontSize: '12px', color: '#89b4fa' }}>(IndexedDB 캐시에 자동 저장됨)</span>
              </div>
            )}

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

            {/* 뷰어 설정 컨트롤러 */}
            <div style={{ backgroundColor: '#181825', padding: '12px 16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>원문 투명도 대조 ({opacity}%)</span>
                <input 
                  type="range" min="0" max="100" value={opacity} 
                  onChange={(e) => setOpacity(e.target.value)}
                  style={{ width: '150px' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>글자 크기 ({fontSize}px)</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => setFontSize(Math.max(12, fontSize - 2))} style={{ backgroundColor: '#313244', border: 'none', color: '#cdd6f4', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>A-</button>
                  <button onClick={() => setFontSize(Math.min(30, fontSize + 2))} style={{ backgroundColor: '#313244', border: 'none', color: '#cdd6f4', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>A+</button>
                </div>
              </div>
            </div>

            {/* 소설 내용 */}
            <div style={{ fontSize: `${fontSize}px`, lineHeight: '1.8', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {viewerParagraphs.map((p, idx) => (
                <div key={idx} style={{ borderBottom: '1px solid #1e1e2e', paddingBottom: '10px' }}>
                  <p style={{ margin: '0 0 6px 0', color: '#cdd6f4' }}>{p.translated}</p>
                  {p.original && (
                    <p style={{ margin: 0, color: '#a6adc8', fontSize: '0.9em', opacity: opacity / 100 }}>
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
            </div>
            {/* 번역 완료된 가상 HTML을 iframe 구조에 주입하여 완벽하게 렌더링 */}
            <iframe 
              srcDoc={novelHtmlResult}
              title="Page Translation Result"
              style={{
                flex: 1,
                border: '1px solid #313244',
                borderRadius: '12px',
                backgroundColor: '#ffffff', // 원본 사이트 가시성을 위한 흰 배경 지정
                width: '100%'
              }}
            />
          </div>
        )}

        {/* 탭 5: 설정 (Settings) */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>설정 & 디바이스 관리</h3>

            {/* API Key 관리 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: '#a6adc8' }}>구글 Gemini API Key 목록 (줄바꿈 구분)</label>
              <textarea 
                rows={4}
                value={apiKeysInput}
                onChange={(e) => setApiKeysInput(e.target.value)}
                placeholder="여기에 API Key를 입력하세요&#10;여러 개인 경우 엔터(줄바꿈)로 구분합니다."
                style={{
                  backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '10px', padding: '12px', color: '#cdd6f4', fontFamily: 'monospace'
                }}
              />
            </div>

            {/* AI 모델 설정 - 1안 스펙으로 동적 바인딩 렌더링 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: '#a6adc8' }}>사용할 AI 모델 (무료 Tier 권장)</label>
              <select 
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '10px', padding: '12px', color: '#cdd6f4'
                }}
              >
                {availableModels.map(model => (
                  <option key={model} value={model}>
                    {model} {model === 'gemini-3.1-flash-lite' ? '(최신 권장)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* 캐시 용량 관리 */}
            <div style={{ backgroundColor: '#181825', padding: '16px', borderRadius: '12px', border: '1px solid #313244', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#89b4fa' }}>로컬 보관함 용량 최적화</h4>
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

            <button 
              onClick={handleSaveSettings}
              style={{
                backgroundColor: '#89b4fa', border: 'none', borderRadius: '10px', padding: '12px', color: '#11111b', fontWeight: 'bold', cursor: 'pointer'
              }}
            >
              설정 저장
            </button>
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
          { id: 'translate', label: '실시간번역', icon: BookOpen }
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
