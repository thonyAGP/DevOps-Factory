import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { ProjectStatus, HistoryEntry } from './types.js';

const HISTORY_MAX_DAYS = 90;

export const updateHistory = (statuses: ProjectStatus[]): void => {
  const historyPath = 'dashboard/history.json';
  let history: HistoryEntry[] = [];

  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8')) as HistoryEntry[];
    } catch {
      history = [];
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const avgHealth = Math.round(statuses.reduce((s, p) => s + p.healthScore, 0) / statuses.length);

  const entry: HistoryEntry = {
    date: today,
    avgHealth,
    failingCI: statuses.filter((p) => p.ciStatus === 'fail').length,
    passingCI: statuses.filter((p) => p.ciStatus === 'pass').length,
    totalOpenPRs: statuses.reduce((s, p) => s + p.openPRs.length, 0),
    perProject: statuses.map((p) => ({
      name: p.name,
      health: p.healthScore,
      ciStatus: p.ciStatus,
    })),
  };

  const existingIdx = history.findIndex((h) => h.date === today);
  if (existingIdx >= 0) {
    history[existingIdx] = entry;
  } else {
    history.push(entry);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  history = history.filter((h) => h.date >= cutoffStr);

  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`History updated (${history.length} entries)`);
};
