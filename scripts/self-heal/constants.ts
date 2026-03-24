export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export const AI_PROVIDERS = [
  {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    timeout: 60_000,
  },
  {
    name: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'llama3.1-8b',
    timeout: 90_000,
  },
] as const;

export const MAX_LOG_LINES = 400;
export const MAX_FILE_SIZE = 50_000;
export const PATTERN_DB_PATH = 'data/patterns.json';
export const COOLDOWN_DB_PATH = 'data/self-heal-cooldown.json';
export const PATTERN_CONFIDENCE_THRESHOLD = 0.8;
export const COOLDOWN_HOURS = 24;
export const MAX_ATTEMPTS_BEFORE_ESCALATION = 2;
export const MAX_OPEN_HEALING_PRS = 3;
export const DEDUP_WINDOW_HOURS = 72;
export const AUTO_MERGE_CONFIDENCE_THRESHOLD = 0.85;
export const AUTO_MERGE_GRADUATED_THRESHOLD = 0.7;
export const STYLECOP_AUTO_FIX = ['SA1028', 'SA1513', 'SA1507', 'SA1124'];
