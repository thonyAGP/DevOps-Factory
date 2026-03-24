import { readFileSync, existsSync } from 'node:fs';
import type { ProjectStatus, HistoryEntry, AlertEvent } from './types.js';

export const detectAlerts = (statuses: ProjectStatus[]): AlertEvent[] => {
  const alerts: AlertEvent[] = [];

  for (const p of statuses) {
    if (p.ciStatus === 'fail') {
      alerts.push({
        type: 'ci_fail',
        project: p.name,
        repo: p.fullName,
        runId: p.lastRun?.id ? String(p.lastRun.id) : '',
        message: `CI is failing on ${p.name} (${p.fullName})`,
      });
    }

    if (p.aiFixPRs.length > 0) {
      alerts.push({
        type: 'ai_fix_pending',
        project: p.name,
        repo: p.fullName,
        runId: '',
        message: `${p.aiFixPRs.length} AI fix PR(s) pending review on ${p.name}`,
      });
    }
  }

  const historyPath = 'dashboard/history.json';
  if (existsSync(historyPath)) {
    try {
      const history = JSON.parse(readFileSync(historyPath, 'utf-8')) as HistoryEntry[];
      if (history.length >= 2) {
        const prev = history[history.length - 2];
        for (const p of statuses) {
          const prevProject = prev.perProject.find((pp) => pp.name === p.name);
          if (prevProject && prevProject.health - p.healthScore >= 15) {
            alerts.push({
              type: 'health_drop',
              project: p.name,
              repo: p.fullName,
              runId: '',
              message: `Health dropped from ${prevProject.health} to ${p.healthScore} on ${p.name}`,
            });
          }
        }
      }
    } catch {
      // ignore history parse errors
    }
  }

  return alerts;
};
