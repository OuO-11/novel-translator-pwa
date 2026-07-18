/**
 * 사용자가 입력한 API 키 목록을 가져옵니다.
 */
export function getApiKeys() {
  const keysStr = localStorage.getItem('noveltrans_api_keys') || '';
  return keysStr.split('\n').map(k => k.trim()).filter(k => k.length > 0);
}

/**
 * API 키 목록을 영구 저장합니다.
 */
export function saveApiKeys(keysArray) {
  const keysStr = keysArray.join('\n');
  localStorage.setItem('noveltrans_api_keys', keysStr);
}

/**
 * 현재 사용 중인 API 키 인덱스를 가져옵니다.
 */
function getActiveKeyIndex() {
  const idx = parseInt(localStorage.getItem('noveltrans_active_key_idx') || '0');
  const keys = getApiKeys();
  if (idx >= keys.length) return 0;
  return idx;
}

/**
 * 사용 중인 API 키 인덱스를 저장합니다.
 */
function setActiveKeyIndex(index) {
  localStorage.setItem('noveltrans_active_key_idx', index.toString());
}

/**
 * 호출 한도 도달 또는 에러 발생 시 다음 API 키로 인덱스를 회전합니다.
 */
export function rotateApiKey() {
  const keys = getApiKeys();
  if (keys.length <= 1) return null; // 회전할 키가 없음

  const currentIdx = getActiveKeyIndex();
  const nextIdx = (currentIdx + 1) % keys.length;
  setActiveKeyIndex(nextIdx);
  console.warn(`[API Key Rotated] Switched key index from ${currentIdx} to ${nextIdx}`);
  return keys[nextIdx];
}

/**
 * 현재 활성화된 API 키를 가져옵니다.
 */
export function getActiveApiKey() {
  const keys = getApiKeys();
  if (keys.length === 0) return null;
  return keys[getActiveKeyIndex()];
}

/**
 * 구글 API를 조회하여 사용 가능한 무료 Tier 권장 AI 모델 목록을 긁어옵니다.
 * @param {string} apiKey 사용할 API Key
 */
export async function fetchAvailableModels(apiKey) {
  if (!apiKey) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('모델 목록을 조회하지 못했습니다.');
    const data = await res.json();
    
    if (!data.models) return [];

    // 1. generateContent 지원 및 2. 무료 Tier 성격인 flash/lite 모델만 화이트리스트 필터링
    const filtered = data.models
      .filter(m => {
        const name = m.name.toLowerCase();
        const supportsGen = m.supportedGenerationMethods?.includes('generateContent');
        const isFreeTier = name.includes('flash') || name.includes('lite');
        return supportsGen && isFreeTier;
      })
      .map(m => {
        // 'models/gemini-3.1-flash-lite' 형식에서 'models/' 접두어 떼기 (선택창 가시성을 위함)
        return m.name.replace(/^models\//, '');
      });

    return filtered;
  } catch (err) {
    console.error('[fetchAvailableModels Error] Fallback to cache:', err);
    return [];
  }
}

/**
 * 구글 Gemini API를 호출하여 번역을 수행합니다. (키 로테이션 및 재시도 기능 탑재)
 * @param {string} textToTranslate 번역할 소설 원문
 * @param {string} systemInstruction 번역에 적용할 상세 프롬프트 (시스템 지시어)
 * @param {string} model 사용할 Gemini 모델명 (예: gemini-3.1-flash-lite)
 */
export async function translateTextWithRotation(textToTranslate, systemInstruction, model = 'gemini-1.5-flash') {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('API Key가 등록되어 있지 않습니다. 설정에서 키를 먼저 입력해 주세요.');
  }

  // 등록된 API 키의 개수만큼 로테이션하며 재시도 수행
  let attempts = 0;
  const maxAttempts = keys.length;

  while (attempts < maxAttempts) {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
      throw new Error('유효한 API Key를 찾을 수 없습니다.');
    }

    const cleanedModelName = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${cleanedModelName}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: textToTranslate }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          { text: systemInstruction }
        ]
      },
      generationConfig: {
        temperature: 0.8,
        topP: 0.8
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const responseData = await response.json();

      // [57단계] 할당량 초과(429) 또는 인증 오류(400/403) 발생 시 키 로테이션 후 재시도
      if (response.status === 429 || (responseData.error && (
        responseData.error.status === 'RESOURCE_EXHAUSTED' || 
        responseData.error.message.includes('API key') ||
        responseData.error.message.includes('Quota exceeded')
      ))) {
        console.warn(`[Gemini API Error] status=${response.status}, message=${responseData.error?.message}. Rotating key...`);
        rotateApiKey();
        attempts++;
        continue; // 다음 루프로 넘어가 새 키로 재시도
      }

      // 2. 기타 모델 404 에러 등 (예: gemini-3.1-flash-lite 모델 미존재 시)
      if (response.status === 404) {
        throw new Error(`모델을 찾을 수 없습니다 (${model}). 지원되지 않는 모델이거나 단종된 세대입니다.`);
      }

      // 3. 일반 오류 처리
      if (!response.ok || responseData.error) {
        throw new Error(responseData.error?.message || `HTTP error! status: ${response.status}`);
      }

      // 4. 번역 결과 반환
      const translatedText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!translatedText) {
        throw new Error('API 응답에서 번역 텍스트를 추출하지 못했습니다.');
      }

      return translatedText;

    } catch (e) {
      if (e.message === '사용자에 의해 번역이 강제 중단되었습니다.') throw e;
      console.warn(`[Gemini API Request Error] ${e.message}`);
      rotateApiKey();
      attempts++;
    }
  }

  // [57단계] 모든 키 소진 시 명시적인 에러 메시지(ALL_KEYS_EXHAUSTED) 반환
  throw new Error('ALL_KEYS_EXHAUSTED');
}

/**
 * 23단계 핵심: 구글 Gemini API의 streamGenerateContent를 호출하여 실시간 스트리밍 번역을 수행합니다.
 * @param {string} textToTranslate 번역할 소설 전체 합산 원문
 * @param {string} systemInstruction 번역에 적용할 상세 프롬프트 (시스템 지시어)
 * @param {string} model 사용할 Gemini 모델명
 * @param {function} onChunk 실시간 번역 텍스트 누적 시 마다 호출되는 콜백 (accumulatedText => {})
 * @param {object} abortSignal 번역 중지 트리거용 AbortSignal
 * @param {string} assistantPrefill (선택) AI가 이어서 작성하도록 미리 던져주는 답변 프리필 (예: "<main>")
 */
export async function translateTextStreamWithRotation(textToTranslate, systemInstruction, model = 'gemini-1.5-flash', onChunk, abortSignal, assistantPrefill = null) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('API Key가 등록되어 있지 않습니다. 설정에서 키를 먼저 입력해 주세요.');
  }

  let attempts = 0;
  const maxAttempts = keys.length;

  while (attempts < maxAttempts) {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
      throw new Error('유효한 API Key를 찾을 수 없습니다.');
    }

    const cleanedModelName = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${cleanedModelName}:streamGenerateContent?key=${apiKey}`;

    const contentsArray = [
      {
        role: "user",
        parts: [{ text: textToTranslate }]
      }
    ];

    if (assistantPrefill) {
      contentsArray.push({
        role: "model",
        parts: [{ text: assistantPrefill }]
      });
    }

    const requestBody = {
      contents: contentsArray,
      systemInstruction: {
        parts: [
          { text: systemInstruction }
        ]
      },
      generationConfig: {
        temperature: 0.8,
        topP: 0.8
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal
      });

      if (response.status === 429) {
        console.warn(`[Gemini API Stream Rate Limit] Rotating key...`);
        rotateApiKey();
        attempts++;
        continue;
      }

      if (response.status === 404) {
        throw new Error(`모델을 찾을 수 없습니다 (${model}).`);
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        // [57단계] 스트리밍에서도 429 에러 명시적 감지 추가 (RESOURCE_EXHAUSTED가 아닐 때도 로테이션)
        if (response.status === 429 || errData.error?.message?.includes('API key') || errData.error?.status === 'RESOURCE_EXHAUSTED') {
          rotateApiKey();
          attempts++;
          continue;
        }
        throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';
      let buffer = '';

      while (true) {
        if (abortSignal?.aborted) {
          reader.releaseLock();
          throw new Error('사용자에 의해 번역이 강제 중단되었습니다.');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 버퍼에서 "text": "..." 필드들만 안전하게 인출하여 파싱하는 정밀 복원 정규식
        const textMatches = [...buffer.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
        let currentFullText = '';
        textMatches.forEach(match => {
          try {
            const rawText = match[1];
            const decoded = JSON.parse(`"${rawText}"`);
            currentFullText += decoded;
          } catch (e) {
            currentFullText += match[1];
          }
        });

        if (currentFullText.length > accumulatedText.length) {
          accumulatedText = currentFullText;
          onChunk(accumulatedText);
        }
      }

      if (accumulatedText.trim() === '') {
        throw new Error(`status: 400 - AI 응답 파싱 실패 또는 Safety 차단.\n[RAW 스트림 JSON]: ${buffer}`);
      }

      return accumulatedText;

    } catch (error) {
      if (error.name === 'AbortError' || abortSignal?.aborted) {
        throw new Error('사용자에 의해 번역이 강제 중단되었습니다.');
      }
      console.error(`[Stream Fetch Failure] Attempt ${attempts + 1}:`, error);

      if (error.message.includes('status: 400')) throw error; // [57단계] 400 에러는 즉시 상위로 던짐

      rotateApiKey();
      attempts++;
    }
  }

  // [57단계] 모든 키 소진 시 명시적인 에러 메시지(ALL_KEYS_EXHAUSTED) 반환
  throw new Error('ALL_KEYS_EXHAUSTED');
}
