import { readFileSync, existsSync } from 'node:fs';

export const getRecommendationsSection = (): string => {
  const recPath = 'dashboard/recommendations.json';
  if (!existsSync(recPath)) return '';

  try {
    const data = JSON.parse(readFileSync(recPath, 'utf-8')) as {
      summary: {
        totalRecommendations: number;
        criticalCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
        topTemplates: Array<{ template: string; count: number }>;
        topRepo: string;
      };
      repos: Array<{
        repo: string;
        healthScore: number;
        recommendations: Array<{
          template: string;
          priority: string;
          reason: string;
        }>;
      }>;
    };

    const s = data.summary;
    const criticals = data.repos
      .flatMap((r) =>
        r.recommendations
          .filter((rec) => rec.priority === 'critical')
          .map((rec) => `${r.repo}: ${rec.reason}`)
      )
      .slice(0, 5);

    const critList =
      criticals.length > 0
        ? `<div class="rec-gaps"><strong style="color:#ef4444">Critical actions:</strong><ul>${criticals.map((c) => `<li>${c}</li>`).join('')}</ul></div>`
        : '';

    return `
  <div class="rec-section">
    <h2>Smart Recommendations</h2>
    <div class="rec-grid">
      <div class="rec-card">
        <div class="rec-value" style="color:#ef4444">${s.criticalCount}</div>
        <div class="rec-label">Critical</div>
      </div>
      <div class="rec-card">
        <div class="rec-value" style="color:#f59e0b">${s.highCount}</div>
        <div class="rec-label">High</div>
      </div>
      <div class="rec-card">
        <div class="rec-value" style="color:#3b82f6">${s.mediumCount}</div>
        <div class="rec-label">Medium</div>
      </div>
      <div class="rec-card">
        <div class="rec-value" style="color:#6b7280">${s.lowCount}</div>
        <div class="rec-label">Low</div>
      </div>
      <div class="rec-card">
        <div class="rec-value" style="color:#22c55e">${s.totalRecommendations}</div>
        <div class="rec-label">Total</div>
      </div>
    </div>
    <div style="font-size:0.75rem;color:#8b949e;margin-bottom:0.4rem">
      Most needed template: ${s.topTemplates?.[0]?.template || 'N/A'} | Most actions: ${s.topRepo}
    </div>
    ${critList}
  </div>`;
  } catch {
    return '';
  }
};
