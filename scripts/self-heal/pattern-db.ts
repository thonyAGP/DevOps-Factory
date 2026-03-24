import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { PATTERN_DB_PATH, PATTERN_CONFIDENCE_THRESHOLD } from './constants.js';
import type { FailedJob } from './types.js';
import type { Pattern, PatternDB } from '../types.js';

const EMPTY_PATTERN_DB: PatternDB = { version: 1, lastUpdated: '', patterns: [] };

export const loadPatterns = (): PatternDB => {
  if (!existsSync(PATTERN_DB_PATH)) return { ...EMPTY_PATTERN_DB };
  try {
    const parsed = JSON.parse(readFileSync(PATTERN_DB_PATH, 'utf-8'));
    if (parsed?.version && Array.isArray(parsed?.patterns)) {
      return parsed as PatternDB;
    }
    return { ...EMPTY_PATTERN_DB };
  } catch {
    return { ...EMPTY_PATTERN_DB };
  }
};

export const matchPattern = (jobs: FailedJob[]): Pattern | null => {
  const db = loadPatterns();
  const allMessages = jobs.flatMap((j) => [...j.annotations.map((a) => a.message), j.logs]);

  for (const pattern of db.patterns) {
    if (pattern.confidence < PATTERN_CONFIDENCE_THRESHOLD) continue;
    if (allMessages.some((msg) => msg.includes(pattern.signature))) {
      console.log(`  Pattern matched: ${pattern.id} (confidence: ${pattern.confidence})`);
      return pattern;
    }
  }

  return null;
};

export const recordPatternHit = (patternId: string, repo: string, success: boolean): void => {
  const db = loadPatterns();
  const pattern = db.patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  pattern.occurrences++;
  if (!pattern.repos_seen.includes(repo)) {
    pattern.repos_seen.push(repo);
  }
  pattern.confidence = success
    ? Math.min(1, pattern.confidence + 0.05)
    : Math.max(0, pattern.confidence - 0.1);
  db.lastUpdated = new Date().toISOString();

  writeFileSync(PATTERN_DB_PATH, JSON.stringify(db, null, 2));
};

export const matchedPatternConfidence = (patternId: string): number => {
  const db = loadPatterns();
  return db.patterns.find((p) => p.id === patternId)?.confidence ?? 0;
};

export const addNewPattern = (signature: string, fix: string, repo: string): string => {
  if (signature.startsWith('Process completed with exit code') || signature.length < 10) {
    return '';
  }
  const db = loadPatterns();
  const id = `auto-${Date.now()}`;
  db.patterns.push({
    id,
    category: 'ci-failure',
    signature,
    fix,
    fixType: 'ai-generated',
    repos_seen: [repo],
    occurrences: 1,
    confidence: 0.5,
  });
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PATTERN_DB_PATH, JSON.stringify(db, null, 2));
  console.log(`  New pattern registered: ${id}`);
  return id;
};
