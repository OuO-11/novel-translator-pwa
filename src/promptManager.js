const PROMPT_STORAGE_KEY = 'noveltrans_prompts_tree';

// 기본 기본적으로 탑재될 중국어 및 일본어 프리셋 정의
const DEFAULT_PROMPTS_TREE = {
  chinese: {
    name: "중국어 번역기",
    presets: {
      default: {
        name: "기본 소설체 번역",
        content: "You are a professional literary translator specializing in translating Chinese web novels (wuxia, xianxia, BL, romance) into natural, fluent, and engaging Korean.\n\n1. Translate the source text into natural Korean novel style (소설체). Avoid mechanical direct translation (직역).\n2. Translate dialogues (대화) using natural Korean colloquial style (구어체).\n3. Return only the translated Korean text without any notes or original Chinese."
      },
      conan: {
        name: "명탐정 코난 특화 번역",
        content: "You are translating a Chinese Detective Conan (명탐정 코난) fanfiction into natural Korean. \n\n1. Match character names with official Korean localizations:\n- 江户川柯南 / 柯南 -> 코난\n- 工藤新一 -> 남도일\n- 毛利兰 -> 유미란\n- 灰原哀 -> 홍장미\n- 安室透 / 降谷零 -> 안기준 / 강준영\n- 赤井秀一 -> 이상윤\n2. Translate in a natural novel tone, preserving mystery/detective jargon in standard Korean localizations."
      },
      naruto: {
        name: "나루토 특화 번역",
        content: "You are translating a Chinese Naruto (나루토) fanfiction into natural Korean.\n\n1. Use official Korean Naruto terms and names:\n- 漩涡鸣人 / 鸣人 -> 나루토\n- 宇智波佐助 / 佐助 -> 사스케\n- 春野樱 / 小樱 -> 사쿠라\n- 旗木卡卡西 -> 카카시\n- 自来也 -> 지라이야\n- 纲手 -> 츠나데\n- 宇智波鼬 -> 이타치\n2. Translate ninja techniques (술법) into natural Korean official names."
      }
    }
  },
  japanese: {
    name: "일본어 번역기",
    presets: {
      default: {
        name: "기본 소설체 번역",
        content: "You are a professional literary translator specializing in translating Japanese web novels (light novels, fantasy, romance) into natural and engaging Korean.\n\n1. Translate into fluent Korean light novel style. Avoid direct translation of Japanese grammar style (e.g., '~의 경우', '~에 있어서' 같은 직역 지양).\n2. Translate dialogues naturally based on character relationships.\n3. Return only the Korean translation."
      }
    }
  }
};

/**
 * 저장소에서 전체 계층형 프롬프트 트리를 불러옵니다. (비어있으면 기본 구조로 초기화)
 */
export function getPromptsTree() {
  const data = localStorage.getItem(PROMPT_STORAGE_KEY);
  if (!data) {
    localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(DEFAULT_PROMPTS_TREE));
    return DEFAULT_PROMPTS_TREE;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse prompt tree:', e);
    return DEFAULT_PROMPTS_TREE;
  }
}

/**
 * 프롬프트 트리를 로컬 저장소에 영구 저장합니다.
 */
export function savePromptsTree(tree) {
  localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(tree));
}

/**
 * 새로운 언어 분류(대분류)를 추가합니다.
 */
export function addLanguageCategory(langId, langName) {
  const tree = getPromptsTree();
  if (tree[langId]) return false; // 이미 존재하는 언어 코드
  
  tree[langId] = {
    name: langName,
    presets: {}
  };
  savePromptsTree(tree);
  return tree;
}

/**
 * 특정 언어 분류 하위에 상세 프리셋(소분류)을 추가하거나 수정합니다.
 */
export function savePreset(langId, presetId, presetName, content) {
  const tree = getPromptsTree();
  if (!tree[langId]) {
    throw new Error(`존재하지 않는 언어 분류 코드입니다: ${langId}`);
  }

  tree[langId].presets[presetId] = {
    name: presetName,
    content: content
  };
  savePromptsTree(tree);
  return tree;
}

/**
 * 특정 프리셋을 삭제합니다.
 */
export function deletePreset(langId, presetId) {
  const tree = getPromptsTree();
  if (tree[langId] && tree[langId].presets[presetId]) {
    delete tree[langId].presets[presetId];
    savePromptsTree(tree);
  }
  return tree;
}

/**
 * 특정 언어의 특정 프리셋 프롬프트 본문을 빠르게 단독 조회합니다.
 */
export function getPromptContent(langId, presetId) {
  const tree = getPromptsTree();
  const preset = tree[langId]?.presets?.[presetId];
  if (!preset) {
    // 찾을 수 없다면 해당 언어의 default를, 그것도 없다면 전체 기본값을 반환
    return tree[langId]?.presets?.default?.content || DEFAULT_PROMPTS_TREE.chinese.presets.default.content;
  }
  return preset.content;
}
