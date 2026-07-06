import { readFileSync, existsSync } from 'node:fs';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

interface RepoRisk {
  name: string;
  repo: string;
  risk: number;
  scorecard: number;
  grade: Grade;
  secrets: number;
  sastErrors: number;
  criticalDeps: number;
  highDeps: number;
  duplicationPct: number | null;
  coveragePct: number | null;
  reasons: string[];
}

interface SecurityRegistry {
  date: string;
  repos: RepoRisk[];
  summary: {
    avgScorecard: number;
    totalRisk: number;
    reposWithSecrets: number;
    reposOverDuplication: number;
    gradeDistribution: Record<Grade, number>;
  };
}

const GRADE_COLOR: Record<Grade, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

const gradeBadge = (grade: Grade): string =>
  `<span class="reg-grade" style="background:${GRADE_COLOR[grade]}">${grade}</span>`;

export const getSecurityRegistrySection = (): string => {
  const path = 'data/security-registry.json';
  if (!existsSync(path)) return '';

  let reg: SecurityRegistry;
  try {
    reg = JSON.parse(readFileSync(path, 'utf-8')) as SecurityRegistry;
  } catch {
    return '';
  }
  if (!reg.repos.length) return '';

  const dist = reg.summary.gradeDistribution;
  const distChips = (['A', 'B', 'C', 'D', 'F'] as Grade[])
    .filter((g) => dist[g] > 0)
    .map((g) => `${gradeBadge(g)}&nbsp;${dist[g]}`)
    .join('&nbsp;&nbsp;');

  // Top 8 by risk — the actionable head of the list, not a 25-row wall
  const rows = reg.repos
    .slice(0, 8)
    .map((r) => {
      const reasons = r.reasons.length ? r.reasons.join(', ') : '—';
      return `<tr>
        <td>${gradeBadge(r.grade)} ${r.name}</td>
        <td class="reg-risk">${r.risk}</td>
        <td class="reg-score">${r.scorecard}/10</td>
        <td class="reg-reasons">${reasons}</td>
      </tr>`;
    })
    .join('\n');

  return `
  <div class="security-registry">
    <h2>Security Posture (registre unifié)</h2>
    <div class="registry-summary">
      <span><strong>${reg.summary.avgScorecard}/10</strong> scorecard moyen</span>
      <span><strong>${reg.summary.totalRisk}</strong> points de risque</span>
      <span><strong>${reg.summary.reposWithSecrets}</strong> repo(s) avec secrets</span>
      <span class="registry-dist">${distChips}</span>
      <span class="registry-date">${reg.date}</span>
    </div>
    <table class="registry-table">
      <thead><tr><th>Repo (top risque)</th><th>Risque</th><th>Scorecard</th><th>Raisons</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
};
