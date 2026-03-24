import { sh as _sh } from '../shell-utils.js';
import { MAX_FILE_SIZE } from './constants.js';

const sh = (cmd: string, timeout = 60_000) => _sh(cmd, { timeout });

export const ghApi = <T>(endpoint: string): T | null => {
  const raw = sh(`gh api ${endpoint}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const fetchFileContent = (repo: string, path: string, branch: string): string | null => {
  const data = ghApi<{ content?: string; size?: number }>(
    `repos/${repo}/contents/${path}?ref=${branch}`
  );
  if (!data?.content) return null;

  try {
    const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    if (decoded.length > MAX_FILE_SIZE) {
      return decoded.slice(0, MAX_FILE_SIZE) + '\n// ... truncated ...';
    }
    return decoded;
  } catch {
    return null;
  }
};

export const fetchFullFileContent = (repo: string, path: string, branch: string): string | null => {
  const data = ghApi<{ content?: string }>(`repos/${repo}/contents/${path}?ref=${branch}`);
  if (!data?.content) return null;
  try {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  } catch {
    return null;
  }
};

export const fetchFileWithErrorContext = (
  repo: string,
  path: string,
  branch: string,
  errorLines: number[],
  windowSize = 30
): string | null => {
  const decoded = fetchFullFileContent(repo, path, branch);
  if (!decoded) return null;

  if (decoded.length <= MAX_FILE_SIZE) return decoded;

  const lines = decoded.split('\n');
  const totalLines = lines.length;

  const headerEnd = Math.min(30, totalLines);

  const includeLines = new Set<number>();
  for (let i = 0; i < headerEnd; i++) includeLines.add(i);

  for (const errLine of errorLines) {
    const idx = errLine - 1;
    const start = Math.max(0, idx - windowSize);
    const end = Math.min(totalLines - 1, idx + windowSize);
    for (let i = start; i <= end; i++) includeLines.add(i);
  }

  const sorted = [...includeLines].sort((a, b) => a - b);
  const result: string[] = [
    `// File: ${path} (${totalLines} lines, showing context around errors)`,
  ];
  let lastLine = -2;

  for (const lineIdx of sorted) {
    if (lineIdx > lastLine + 1) {
      result.push(`// ... lines ${lastLine + 2}-${lineIdx} omitted ...`);
    }
    result.push(lines[lineIdx]);
    lastLine = lineIdx;
  }

  if (lastLine < totalLines - 1) {
    result.push(`// ... lines ${lastLine + 2}-${totalLines} omitted ...`);
  }

  return result.join('\n');
};

export const getDefaultBranch = (repo: string): string => {
  const data = ghApi<{ default_branch?: string }>(`repos/${repo}`);
  return data?.default_branch || 'main';
};
