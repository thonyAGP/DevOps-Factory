import { readFileSync, existsSync } from 'node:fs';

export const getCostSection = (): string => {
  const costPath = 'dashboard/cost-report.json';
  if (!existsSync(costPath)) return '';

  try {
    const cost = JSON.parse(readFileSync(costPath, 'utf-8')) as {
      summary: {
        totalMinutes: number;
        totalRuns: number;
        wastedMinutes: number;
        mostExpensiveRepo: string;
        mostExpensiveWorkflow: string;
        totalRecommendations: number;
        estimatedMonthlyCost: number;
      };
      repos: Array<{
        repo: string;
        totalMinutes: number;
        totalRuns: number;
        recommendations: string[];
      }>;
    };

    const s = cost.summary;
    const wastedPct = s.totalMinutes > 0 ? Math.round((s.wastedMinutes / s.totalMinutes) * 100) : 0;
    const freeUsed = Math.min(100, Math.round((s.totalMinutes / 2000) * 100));
    const freeColor = freeUsed >= 90 ? '#ef4444' : freeUsed >= 70 ? '#f59e0b' : '#22c55e';

    const allRecs = cost.repos.flatMap((r) => r.recommendations).slice(0, 5);
    const recsList =
      allRecs.length > 0
        ? `<div class="cost-recs"><strong style="color:#8b949e">Top recommendations:</strong><ul>${allRecs.map((r) => `<li>${r}</li>`).join('')}</ul></div>`
        : '';

    return `
  <div class="cost-section">
    <h2>CI Cost Monitor</h2>
    <div class="cost-grid">
      <div class="cost-card">
        <div class="cost-value" style="color:#34d399">${s.totalMinutes}</div>
        <div class="cost-label">Minutes (30d)</div>
      </div>
      <div class="cost-card">
        <div class="cost-value" style="color:#34d399">${s.totalRuns}</div>
        <div class="cost-label">Total Runs</div>
      </div>
      <div class="cost-card">
        <div class="cost-value" style="color:${wastedPct > 20 ? '#ef4444' : '#f59e0b'}">${s.wastedMinutes}</div>
        <div class="cost-label">Wasted min (${wastedPct}%)</div>
      </div>
      <div class="cost-card">
        <div class="cost-value" style="color:${freeColor}">${freeUsed}%</div>
        <div class="cost-label">Free tier used</div>
      </div>
      <div class="cost-card">
        <div class="cost-value" style="color:${s.estimatedMonthlyCost > 0 ? '#ef4444' : '#22c55e'}">$${s.estimatedMonthlyCost}</div>
        <div class="cost-label">Est. cost/mo</div>
      </div>
    </div>
    <div style="font-size:0.75rem;color:#8b949e;margin-bottom:0.4rem">
      Most expensive: ${s.mostExpensiveRepo} | ${s.totalRecommendations} optimization(s) found
    </div>
    ${recsList}
  </div>`;
  } catch {
    return '';
  }
};
