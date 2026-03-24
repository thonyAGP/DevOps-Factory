import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { COOLDOWN_DB_PATH, COOLDOWN_HOURS, MAX_ATTEMPTS_BEFORE_ESCALATION } from './constants.js';
import type { CooldownEntry } from './types.js';

const loadCooldown = (): CooldownEntry[] => {
  if (!existsSync(COOLDOWN_DB_PATH)) return [];
  try {
    return JSON.parse(readFileSync(COOLDOWN_DB_PATH, 'utf-8')) as CooldownEntry[];
  } catch {
    return [];
  }
};

const saveCooldown = (entries: CooldownEntry[]): void => {
  writeFileSync(COOLDOWN_DB_PATH, JSON.stringify(entries, null, 2));
};

export const cleanOldCooldowns = (): void => {
  const entries = loadCooldown();
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const filtered = entries.filter((e) => {
    const lastAttemptTime = new Date(e.lastAttempt).getTime();
    return now - lastAttemptTime < sevenDaysMs;
  });
  if (filtered.length < entries.length) {
    saveCooldown(filtered);
  }
};

export const checkCooldown = (
  repo: string,
  errorSignature: string
): 'proceed' | 'skip' | 'escalate' => {
  cleanOldCooldowns();
  const entries = loadCooldown();
  const entry = entries.find((e) => e.repo === repo && e.errorSignature === errorSignature);

  if (!entry) {
    return 'proceed';
  }

  const lastAttemptTime = new Date(entry.lastAttempt).getTime();
  const now = Date.now();
  const hoursSinceLastAttempt = (now - lastAttemptTime) / (60 * 60 * 1000);

  if (hoursSinceLastAttempt < COOLDOWN_HOURS) {
    console.log(
      `Cooldown active for ${repo} (${errorSignature.slice(0, 40)}...) - last attempt ${Math.round(hoursSinceLastAttempt)}h ago`
    );
    return 'skip';
  }

  if (entry.attempts >= MAX_ATTEMPTS_BEFORE_ESCALATION) {
    console.log(
      `Max attempts reached (${entry.attempts}) for ${repo} (${errorSignature.slice(0, 40)}...) - escalating`
    );
    return 'escalate';
  }

  return 'proceed';
};

export const recordAttempt = (repo: string, errorSignature: string, success: boolean): void => {
  const entries = loadCooldown();
  let entry = entries.find((e) => e.repo === repo && e.errorSignature === errorSignature);

  if (!entry) {
    entry = {
      repo,
      errorSignature,
      attempts: 0,
      lastAttempt: new Date().toISOString(),
      status: 'pending',
    };
    entries.push(entry);
  }

  entry.attempts++;
  entry.lastAttempt = new Date().toISOString();
  if (success) {
    entry.status = 'fixed';
  }

  saveCooldown(entries);
};
