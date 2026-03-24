export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
}

export interface FailedJob {
  id: number;
  name: string;
  annotations: Annotation[];
  logs: string;
}

export interface GeminiFix {
  path: string;
  content: string;
  replacements?: Array<{ search: string; replace: string }>;
}

export interface GeminiResponse {
  fixes: GeminiFix[];
  explanation: string;
}

export interface CooldownEntry {
  repo: string;
  errorSignature: string;
  attempts: number;
  lastAttempt: string;
  status: 'pending' | 'fixed' | 'escalated';
}
