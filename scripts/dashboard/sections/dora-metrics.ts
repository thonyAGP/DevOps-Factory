import { readFileSync, existsSync } from 'node:fs';

export const getDoraSection = (): string => {
  const doraPath = 'dashboard/dora-metrics.json';
  if (!existsSync(doraPath)) return '';

  try {
    const dora = JSON.parse(readFileSync(doraPath, 'utf-8')) as {
      summary: {
        overallRating: string;
        avgDeployFreq: number;
        avgLeadTime: number;
        avgMTTR: number;
        avgChangeFailRate: number;
        totalRepos: number;
        eliteCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
      };
      repos: Array<{
        repo: string;
        rating: string;
        deploymentFrequency: number;
        leadTimeHours: number;
        mttrHours: number;
        changeFailureRate: number;
      }>;
    };

    const s = dora.summary;
    const ratingColor = (r: string) =>
      r === 'elite' ? '#22c55e' : r === 'high' ? '#3b82f6' : r === 'medium' ? '#f59e0b' : '#ef4444';

    const repoRows = dora.repos
      .map(
        (r) =>
          `<div class="dora-repo-row">
        <span>${r.repo}</span>
        <span><span class="dora-rating" style="background:${ratingColor(r.rating)}30;color:${ratingColor(r.rating)}">${r.rating}</span></span>
        <span style="color:#8b949e">${r.deploymentFrequency}/wk</span>
        <span style="color:#8b949e">${r.leadTimeHours}h</span>
        <span style="color:#8b949e">${r.changeFailureRate}%</span>
      </div>`
      )
      .join('');

    return `
  <div class="dora-section">
    <h2>DORA Metrics</h2>
    <div class="dora-grid">
      <div class="dora-card" style="border-left:3px solid ${ratingColor(s.overallRating)}">
        <div class="dora-value" style="color:${ratingColor(s.overallRating)}">${s.overallRating.toUpperCase()}</div>
        <div class="dora-label">Overall Rating</div>
      </div>
      <div class="dora-card">
        <div class="dora-value" style="color:#a78bfa">${s.avgDeployFreq}</div>
        <div class="dora-label">Deploys/week</div>
      </div>
      <div class="dora-card">
        <div class="dora-value" style="color:#a78bfa">${s.avgLeadTime}h</div>
        <div class="dora-label">Lead Time</div>
      </div>
      <div class="dora-card">
        <div class="dora-value" style="color:#a78bfa">${s.avgMTTR}h</div>
        <div class="dora-label">MTTR</div>
      </div>
      <div class="dora-card">
        <div class="dora-value" style="color:${s.avgChangeFailRate < 15 ? '#22c55e' : s.avgChangeFailRate < 30 ? '#f59e0b' : '#ef4444'}">${s.avgChangeFailRate}%</div>
        <div class="dora-label">Change Fail Rate</div>
      </div>
    </div>
    <div style="font-size:0.75rem;color:#8b949e;margin-bottom:0.4rem">
      ${s.eliteCount} elite, ${s.highCount} high, ${s.mediumCount} medium, ${s.lowCount} low (${s.totalRepos} repos)
    </div>
    <div class="dora-repo-list">${repoRows}</div>
  </div>`;
  } catch {
    return '';
  }
};
