/**
 * central-scan.ts
 *
 * Centralized security scans for all managed repos.
 *
 * Runs FROM the public DevOps-Factory repo, where Actions minutes are
 * unlimited, instead of inside each private repo. On the GitHub Free plan,
 * private repos have no Code Scanning tab (SARIF upload requires Advanced
 * Security) and share a 2000 min/month Actions quota — so scheduled scans
 * there burn quota and their results are lost. Here, each repo is cloned
 * with FACTORY_PAT and scanned locally; results land in the dashboard data
 * and a consolidated GitHub issue.
 *
 * Scanners (none require installing the target repo's dependencies):
 * - gitleaks: exposed secrets (full git history)
 * - semgrep:  SAST, OWASP Top 10 + stack-specific rulesets
 * - trivy fs: vulnerable dependencies (lockfiles) + Dockerfile/IaC misconfigs
 * - jscpd:    duplicated code (SonarQube-style copy/paste detection)
 *
 * Output:
 * - data/central-scan-latest.json  (consumed by the dashboard)
 * - data/central-scan-report.md    (human-readable report)
 * - GitHub issue on the Factory repo (label: central-scan), only if findings
 *
 * Usage: pnpm central-scan [-- --dry-run] [-- --repo thonyAGP/xxx]
 */

import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { GITHUB_OWNER, KNOWN_PROJECTS, type ProjectConfig } from '../factory.config.js';
import { logActivity } from './activity-logger.js';
import { sh, tmpDir } from './shell-utils.js';

export type ScannerName = 'gitleaks' | 'semgrep' | 'trivy' | 'jscpd';
export type ScannerStatus = 'clean' | 'findings' | 'error' | 'skipped';

export interface ScannerResult {
  scanner: ScannerName;
  status: ScannerStatus;
  findings: number;
  bySeverity: Record<string, number>;
  /** Top finding summaries, capped for report readability */
  top: string[];
  /** Scanner-specific metrics (e.g. jscpd duplication percentage) */
  metrics?: Record<string, number>;
}

export interface RepoScanResult {
  name: string;
  repo: string;
  stack: string;
  cloned: boolean;
  scanners: ScannerResult[];
}

const TOP_FINDINGS_LIMIT = 5;
const SCAN_TIMEOUT_MS = 300_000;
const SCAN_MAX_BUFFER = 64 * 1024 * 1024;
/** SonarQube's default duplication quality gate: fail above 3% duplicated lines */
export const DUPLICATION_THRESHOLD_PCT = 3;

/** Semgrep rulesets per stack — mirrors templates/semgrep.yml stack detection. */
export const semgrepConfigsForStack = (stack: ProjectConfig['stack']): string => {
  switch (stack) {
    case 'nextjs':
      return '--config p/owasp-top-ten --config p/typescript --config p/react --config p/nextjs';
    case 'fastify':
    case 'node':
    case 'astro':
      return '--config p/owasp-top-ten --config p/typescript';
    case 'dotnet':
      return '--config p/owasp-top-ten --config p/csharp';
    default:
      return '--config p/owasp-top-ten';
  }
};

const errorResult = (scanner: ScannerName): ScannerResult => ({
  scanner,
  status: 'error',
  findings: 0,
  bySeverity: {},
  top: [],
});

/** Parse gitleaks JSON report (array of leak findings). */
export const parseGitleaks = (json: string): ScannerResult => {
  try {
    const leaks = JSON.parse(json || '[]') as {
      RuleID?: string;
      File?: string;
      StartLine?: number;
    }[];
    if (!Array.isArray(leaks)) return errorResult('gitleaks');
    return {
      scanner: 'gitleaks',
      status: leaks.length > 0 ? 'findings' : 'clean',
      findings: leaks.length,
      bySeverity: leaks.length > 0 ? { SECRET: leaks.length } : {},
      top: leaks
        .slice(0, TOP_FINDINGS_LIMIT)
        .map((l) => `${l.RuleID ?? 'secret'} in ${l.File ?? '?'}:${l.StartLine ?? '?'}`),
    };
  } catch {
    return errorResult('gitleaks');
  }
};

/** Parse semgrep --json output. */
export const parseSemgrep = (json: string): ScannerResult => {
  try {
    const data = JSON.parse(json || '{}') as {
      results?: {
        check_id?: string;
        path?: string;
        start?: { line?: number };
        extra?: { severity?: string };
      }[];
    };
    const results = data.results ?? [];
    const bySeverity: Record<string, number> = {};
    for (const r of results) {
      const sev = r.extra?.severity ?? 'UNKNOWN';
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }
    return {
      scanner: 'semgrep',
      status: results.length > 0 ? 'findings' : 'clean',
      findings: results.length,
      bySeverity,
      top: results
        .slice(0, TOP_FINDINGS_LIMIT)
        .map((r) => `${r.check_id ?? 'rule'} in ${r.path ?? '?'}:${r.start?.line ?? '?'}`),
    };
  } catch {
    return errorResult('semgrep');
  }
};

/** Parse trivy fs --format json output (vulnerabilities + misconfigurations). */
export const parseTrivy = (json: string): ScannerResult => {
  try {
    const data = JSON.parse(json || '{}') as {
      Results?: {
        Vulnerabilities?: { VulnerabilityID?: string; PkgName?: string; Severity?: string }[];
        Misconfigurations?: { ID?: string; Title?: string; Severity?: string }[];
        Target?: string;
      }[];
    };
    const bySeverity: Record<string, number> = {};
    const top: string[] = [];
    let findings = 0;
    for (const result of data.Results ?? []) {
      for (const v of result.Vulnerabilities ?? []) {
        findings++;
        const sev = v.Severity ?? 'UNKNOWN';
        bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
        if (top.length < TOP_FINDINGS_LIMIT) {
          top.push(`${v.VulnerabilityID ?? 'vuln'} ${v.PkgName ?? '?'} (${sev})`);
        }
      }
      for (const m of result.Misconfigurations ?? []) {
        findings++;
        const sev = m.Severity ?? 'UNKNOWN';
        bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
        if (top.length < TOP_FINDINGS_LIMIT) {
          top.push(`${m.ID ?? 'misconfig'} ${m.Title ?? ''} (${sev}) in ${result.Target ?? '?'}`);
        }
      }
    }
    return {
      scanner: 'trivy',
      status: findings > 0 ? 'findings' : 'clean',
      findings,
      bySeverity,
      top,
    };
  } catch {
    return errorResult('trivy');
  }
};

/** Parse jscpd JSON report (jscpd-report.json). */
export const parseJscpd = (json: string): ScannerResult => {
  try {
    const data = JSON.parse(json || '{}') as {
      statistics?: { total?: { percentage?: number; clones?: number; duplicatedLines?: number } };
      duplicates?: {
        firstFile?: { name?: string; start?: number };
        secondFile?: { name?: string; start?: number };
        lines?: number;
      }[];
    };
    const total = data.statistics?.total;
    if (!total) return errorResult('jscpd');
    const percentage = total.percentage ?? 0;
    const clones = data.duplicates?.length ?? total.clones ?? 0;
    return {
      scanner: 'jscpd',
      status: percentage >= DUPLICATION_THRESHOLD_PCT ? 'findings' : 'clean',
      findings: clones,
      bySeverity: clones > 0 ? { DUPLICATION: clones } : {},
      top: (data.duplicates ?? [])
        .slice(0, TOP_FINDINGS_LIMIT)
        .map(
          (d) =>
            `${d.firstFile?.name ?? '?'}:${d.firstFile?.start ?? '?'} <-> ${d.secondFile?.name ?? '?'}:${d.secondFile?.start ?? '?'} (${d.lines ?? '?'} lines)`
        ),
      metrics: { duplicationPct: Math.round(percentage * 100) / 100 },
    };
  } catch {
    return errorResult('jscpd');
  }
};

export const totalFindings = (results: RepoScanResult[]): number =>
  results.reduce(
    (sum, r) =>
      sum + r.scanners.reduce((s, sc) => s + (sc.status === 'findings' ? sc.findings : 0), 0),
    0
  );

const statusIcon = (s: ScannerStatus): string =>
  s === 'clean' ? '🟢' : s === 'findings' ? '🔴' : s === 'error' ? '⚠️' : '⏭️';

const scannerCell = (r: RepoScanResult, name: ScannerName): string => {
  const sc = r.scanners.find((s) => s.scanner === name);
  if (!sc) return '—';
  if (
    sc.metrics?.duplicationPct !== undefined &&
    sc.status !== 'error' &&
    sc.status !== 'skipped'
  ) {
    return `${statusIcon(sc.status)} ${sc.metrics.duplicationPct}%`;
  }
  if (sc.status === 'clean') return '🟢 0';
  if (sc.status === 'findings') return `🔴 ${sc.findings}`;
  return statusIcon(sc.status);
};

/** Build the consolidated markdown report. */
export const buildReport = (results: RepoScanResult[], date: string): string => {
  let report = `# Central Security Scan - ${date}\n\n`;
  report += `Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). `;
  report += `Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.\n\n`;
  report += `**Total findings: ${totalFindings(results)}** sur ${results.length} repos\n\n`;
  report += `| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |\n`;
  report += `|------|--------------------|----------------|---------------------|---------------------|\n`;
  for (const r of results) {
    if (!r.cloned) {
      report += `| ${r.name} | ⚠️ clone failed | — | — | — |\n`;
      continue;
    }
    report += `| ${r.name} | ${scannerCell(r, 'gitleaks')} | ${scannerCell(r, 'semgrep')} | ${scannerCell(r, 'trivy')} | ${scannerCell(r, 'jscpd')} |\n`;
  }
  report += `\n`;

  for (const r of results) {
    const withFindings = r.scanners.filter((s) => s.status === 'findings');
    if (withFindings.length === 0) continue;
    report += `<details><summary><b>${r.name}</b> — ${withFindings.reduce((s, sc) => s + sc.findings, 0)} finding(s)</summary>\n\n`;
    for (const sc of withFindings) {
      const sev = Object.entries(sc.bySeverity)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      report += `**${sc.scanner}** (${sev})\n`;
      for (const t of sc.top) report += `- \`${t}\`\n`;
      if (sc.findings > sc.top.length) {
        report += `- … et ${sc.findings - sc.top.length} de plus\n`;
      }
      report += `\n`;
    }
    report += `</details>\n\n`;
  }

  report += `---\n_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_\n`;
  return report;
};

const scannerAvailable = (cmd: string): boolean => sh(`${cmd} 2>&1`).length > 0;

// jscpd is a Factory devDependency — resolve its binary from the Factory checkout,
// since scans run with cwd inside the cloned target repos
const JSCPD_BIN = `${process.cwd()}/node_modules/.bin/jscpd`;

const runGitleaks = (dir: string): ScannerResult => {
  const out = `${tmpDir}/gitleaks-report.json`;
  rmSync(out, { force: true });
  sh(
    `gitleaks detect --source . --redact --exit-code 0 --report-format json --report-path "${out}"`,
    { cwd: dir, timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_BUFFER, fallbackOnError: 'stdout' }
  );
  if (!existsSync(out)) return errorResult('gitleaks');
  return parseGitleaks(readFileSync(out, 'utf-8'));
};

const runSemgrep = (dir: string, stack: ProjectConfig['stack']): ScannerResult => {
  const out = `${tmpDir}/semgrep-report.json`;
  rmSync(out, { force: true });
  sh(
    `semgrep scan ${semgrepConfigsForStack(stack)} --json --output "${out}" --metrics=off --quiet`,
    {
      cwd: dir,
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: SCAN_MAX_BUFFER,
      fallbackOnError: 'stdout',
    }
  );
  if (!existsSync(out)) return errorResult('semgrep');
  return parseSemgrep(readFileSync(out, 'utf-8'));
};

const runJscpd = (dir: string): ScannerResult => {
  const outDir = `${tmpDir}/jscpd-out`;
  rmSync(outDir, { recursive: true, force: true });
  sh(
    `"${JSCPD_BIN}" . --reporters json --output "${outDir}" --silent --gitignore ` +
      `--ignore "**/node_modules/**,**/dist/**,**/build/**,**/.next/**,**/coverage/**,**/*.min.js,**/pnpm-lock.yaml,**/package-lock.json,**/yarn.lock"`,
    { cwd: dir, timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_BUFFER, fallbackOnError: 'stdout' }
  );
  const out = `${outDir}/jscpd-report.json`;
  if (!existsSync(out)) return errorResult('jscpd');
  return parseJscpd(readFileSync(out, 'utf-8'));
};

const runTrivy = (dir: string): ScannerResult => {
  const out = `${tmpDir}/trivy-report.json`;
  rmSync(out, { force: true });
  sh(
    `trivy fs . --scanners vuln,misconfig --severity CRITICAL,HIGH --format json --output "${out}" --quiet`,
    { cwd: dir, timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_BUFFER, fallbackOnError: 'stdout' }
  );
  if (!existsSync(out)) return errorResult('trivy');
  return parseTrivy(readFileSync(out, 'utf-8'));
};

const scanRepo = (
  project: ProjectConfig,
  available: Record<ScannerName, boolean>
): RepoScanResult => {
  const dir = `${tmpDir}/central-scan/${project.name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Full clone: gitleaks scans the entire git history
  const cloned = sh(`gh repo clone ${project.repo} "${dir}" 2>&1 && echo OK`, {
    timeout: 180_000,
    maxBuffer: SCAN_MAX_BUFFER,
    fallbackOnError: 'stdout',
  }).includes('OK');

  const result: RepoScanResult = {
    name: project.name,
    repo: project.repo,
    stack: project.stack,
    cloned,
    scanners: [],
  };
  if (!cloned) return result;

  const skipped = (scanner: ScannerName): ScannerResult => ({
    scanner,
    status: 'skipped',
    findings: 0,
    bySeverity: {},
    top: [],
  });

  result.scanners.push(available.gitleaks ? runGitleaks(dir) : skipped('gitleaks'));
  result.scanners.push(available.semgrep ? runSemgrep(dir, project.stack) : skipped('semgrep'));
  result.scanners.push(available.trivy ? runTrivy(dir) : skipped('trivy'));
  result.scanners.push(available.jscpd ? runJscpd(dir) : skipped('jscpd'));

  rmSync(dir, { recursive: true, force: true });
  return result;
};

const publishIssue = (factoryRepo: string, report: string, findings: number): void => {
  const LABEL = 'central-scan';

  // Close previous open reports
  const existing = sh(
    `gh issue list --repo ${factoryRepo} --label "${LABEL}" --state open --json number`
  );
  try {
    const issues = JSON.parse(existing || '[]') as { number: number }[];
    for (const issue of issues) {
      sh(
        `gh issue close ${issue.number} --repo ${factoryRepo} --comment "Superseded by new report"`
      );
    }
  } catch {
    // ignore
  }

  if (findings === 0) return;

  sh(
    `gh label create "${LABEL}" --repo ${factoryRepo} --color "D93F0B" --description "Central security scan report" --force`
  );
  const tmpFile = `${tmpDir}/central-scan-body.md`;
  writeFileSync(tmpFile, report);
  sh(
    `gh issue create --repo ${factoryRepo} --title "Central Security Scan - ${new Date().toISOString().split('T')[0]}" --body-file "${tmpFile}" --label "${LABEL}"`
  );
};

const main = (): void => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const repoFilter = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : undefined;
  const factoryRepo = process.env.GITHUB_REPOSITORY ?? `${GITHUB_OWNER}/DevOps-Factory`;

  const available: Record<ScannerName, boolean> = {
    gitleaks: scannerAvailable('gitleaks version'),
    semgrep: scannerAvailable('semgrep --version'),
    trivy: scannerAvailable('trivy --version'),
    jscpd: existsSync(JSCPD_BIN),
  };
  console.log(
    `Scanners: gitleaks=${available.gitleaks} semgrep=${available.semgrep} trivy=${available.trivy} jscpd=${available.jscpd}`
  );

  const targets = KNOWN_PROJECTS.filter((p) => !repoFilter || p.repo === repoFilter);
  console.log(`Scanning ${targets.length} repo(s)...\n`);

  const results: RepoScanResult[] = [];
  for (const project of targets) {
    process.stdout.write(`${project.name} ... `);
    const result = scanRepo(project, available);
    results.push(result);
    if (!result.cloned) {
      console.log('clone failed');
      continue;
    }
    console.log(
      result.scanners
        .map((s) => `${s.scanner}: ${s.status}${s.findings ? ` (${s.findings})` : ''}`)
        .join(', ')
    );
  }

  const date = new Date().toISOString().split('T')[0];
  const report = buildReport(results, date);
  const findings = totalFindings(results);

  mkdirSync('data', { recursive: true });
  writeFileSync(
    'data/central-scan-latest.json',
    JSON.stringify({ version: 1, date, totalFindings: findings, repos: results }, null, 2)
  );
  writeFileSync('data/central-scan-report.md', report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }

  if (!dryRun) {
    publishIssue(factoryRepo, report, findings);
    logActivity(
      'central-scan',
      'scan-complete',
      `${targets.length} repos scanned, ${findings} findings`,
      findings > 0 ? 'warning' : 'success'
    );
  }

  console.log(`\nTotal: ${findings} finding(s) across ${results.length} repo(s)`);
};

const isDirectRun =
  !process.env.VITEST && process.argv[1]?.replace(/\\/g, '/').endsWith('central-scan.ts');
if (isDirectRun) main();
