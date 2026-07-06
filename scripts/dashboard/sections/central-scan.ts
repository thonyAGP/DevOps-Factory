import { readFileSync, existsSync } from 'node:fs';

interface ScanScanner {
  scanner: string;
  status: string;
  findings: number;
  bySeverity: Record<string, number>;
  metrics?: Record<string, number>;
}

interface ScanRepo {
  name: string;
  repo: string;
  cloned: boolean;
  scanners: ScanScanner[];
}

interface CentralScanData {
  date: string;
  totalFindings: number;
  repos: ScanRepo[];
}

const cell = (repo: ScanRepo, scanner: string): string => {
  const s = repo.scanners.find((x) => x.scanner === scanner);
  if (!s) return '<td class="scan-na">—</td>';
  if (s.scanner === 'jscpd' && s.metrics?.duplicationPct !== undefined) {
    const pct = s.metrics.duplicationPct;
    const cls = s.status === 'findings' ? 'scan-bad' : 'scan-ok';
    return `<td class="${cls}">${pct}%</td>`;
  }
  if (s.status === 'clean') return '<td class="scan-ok">0</td>';
  if (s.status === 'findings') return `<td class="scan-bad">${s.findings}</td>`;
  return `<td class="scan-warn">${s.status}</td>`;
};

export const getCentralScanSection = (): string => {
  const path = 'data/central-scan-latest.json';
  if (!existsSync(path)) return '';

  let data: CentralScanData;
  try {
    data = JSON.parse(readFileSync(path, 'utf-8')) as CentralScanData;
  } catch {
    return '';
  }

  const reposWithSecrets = data.repos.filter((r) =>
    r.scanners.some((s) => s.scanner === 'gitleaks' && s.status === 'findings')
  ).length;
  const reposOverDupThreshold = data.repos.filter((r) =>
    r.scanners.some((s) => s.scanner === 'jscpd' && s.status === 'findings')
  ).length;

  const rows = data.repos
    .map((r) => {
      if (!r.cloned) {
        return `<tr><td>${r.name}</td><td colspan="4" class="scan-warn">clone failed</td></tr>`;
      }
      return `<tr><td>${r.name}</td>${cell(r, 'gitleaks')}${cell(r, 'semgrep')}${cell(r, 'trivy')}${cell(r, 'jscpd')}</tr>`;
    })
    .join('\n');

  return `
  <div class="central-scan">
    <h2>Security &amp; Duplication Scan</h2>
    <div class="central-scan-summary">
      <span><strong>${data.totalFindings}</strong> findings sécurité</span>
      <span><strong>${reposWithSecrets}</strong> repo(s) avec secrets</span>
      <span><strong>${reposOverDupThreshold}</strong> repo(s) &gt; 3% duplication</span>
      <span class="central-scan-date">Scan du ${data.date} — hebdomadaire</span>
    </div>
    <details>
      <summary>Détail par repo</summary>
      <table class="central-scan-table">
        <thead><tr><th>Repo</th><th>Secrets</th><th>SAST</th><th>Deps</th><th>Duplication</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </details>
  </div>`;
};
