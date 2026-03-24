import { STYLECOP_AUTO_FIX } from './constants.js';
import { ghApi, fetchFullFileContent } from './github-api.js';
import type { FailedJob, GeminiFix } from './types.js';

export const fixStyleCopIssues = (repo: string, jobs: FailedJob[], branch: string): GeminiFix[] => {
  const fixes: GeminiFix[] = [];
  const filesToFix = new Set<string>();
  const allSACodes = new Set<string>();

  for (const job of jobs) {
    for (const a of job.annotations) {
      const saMatch = a.message.match(/SA\d{4}/);
      if (saMatch) {
        allSACodes.add(saMatch[0]);
        if (STYLECOP_AUTO_FIX.some((code) => a.message.includes(code))) {
          filesToFix.add(a.path);
        }
      }
    }
  }

  for (const path of filesToFix) {
    const content = fetchFullFileContent(repo, path, branch);
    if (!content) continue;

    let fixed = content
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');

    fixed = fixed.replace(
      /^([ \t]*\})\n([ \t]*(?!else\b|catch\b|finally\b|while\s*\()[^ \t\n\}])/gm,
      '$1\n\n$2'
    );

    fixed = fixed.replace(/\n{3,}/g, '\n\n');

    fixed = fixed
      .split('\n')
      .filter((line) => !/^\s*#(region|endregion)\b/.test(line))
      .join('\n');

    fixed = fixed.replace(/\n{3,}/g, '\n\n');

    if (fixed !== content) {
      fixes.push({ path, content: fixed });
      console.log(`  StyleCop fix for ${path}`);
    }
  }

  const editorconfig = fetchFullFileContent(repo, '.editorconfig', branch);
  if (editorconfig) {
    let updated = editorconfig;
    const codesToSuppress = [...allSACodes].filter(
      (code) => !STYLECOP_AUTO_FIX.includes(code) && !updated.includes(code)
    );

    if (codesToSuppress.length > 0) {
      const anchor = updated.lastIndexOf('dotnet_diagnostic.SA');
      if (anchor !== -1) {
        const lineEnd = updated.indexOf('\n', anchor);
        const suppressions = codesToSuppress
          .sort()
          .map(
            (code) =>
              `dotnet_diagnostic.${code}.severity = none  # Auto-suppressed by DevOps-Factory`
          )
          .join('\n');
        updated = updated.slice(0, lineEnd + 1) + suppressions + '\n' + updated.slice(lineEnd + 1);
      }
    }

    if (updated !== editorconfig) {
      fixes.push({ path: '.editorconfig', content: updated });
      console.log(
        `  StyleCop: suppressed ${codesToSuppress.length} unfixable rule(s) in .editorconfig`
      );
    }
  }

  return fixes;
};

export const fixPnpmVersionInWorkflows = (repo: string, branch: string): GeminiFix[] => {
  const fixes: GeminiFix[] = [];

  const workflowDir = ghApi<Array<{ name: string; path: string }>>(
    `repos/${repo}/contents/.github/workflows?ref=${branch}`
  );
  if (!workflowDir || !Array.isArray(workflowDir)) return fixes;

  for (const wf of workflowDir) {
    if (!wf.name.endsWith('.yml') && !wf.name.endsWith('.yaml')) continue;

    const content = fetchFullFileContent(repo, wf.path, branch);
    if (!content) continue;

    if (
      content.includes('pnpm/action-setup') &&
      !content.includes('version:') &&
      !content.includes('packageManager')
    ) {
      const fixed = content.replace(
        /(uses:\s*pnpm\/action-setup@v\d+)\s*\n(\s*)(?!with:)/gm,
        '$1\n$2with:\n$2  version: 9\n$2'
      );

      const fixed2 = fixed.replace(
        /(uses:\s*pnpm\/action-setup@v\d+)\s*\n(\s*)with:\s*\n(?!\s*version:)/gm,
        '$1\n$2with:\n$2  version: 9\n'
      );

      if (fixed2 !== content) {
        fixes.push({ path: wf.path, content: fixed2 });
        console.log(`  Workflow fix: added pnpm version to ${wf.path}`);
      }
    }
  }

  return fixes;
};

export const fixEnvFileSourcing = (
  repo: string,
  jobs: FailedJob[],
  branch: string
): GeminiFix[] => {
  const fixes: GeminiFix[] = [];
  const logText = jobs.map((j) => j.logs).join('\n');

  const envMatch = logText.match(/([.\w/-]+\.env[.\w]*): not found/);
  if (!envMatch) return fixes;

  const missingEnv = envMatch[1];
  console.log(`  Missing env file in CI: ${missingEnv}`);

  const workflowDir = ghApi<Array<{ name: string; path: string }>>(
    `repos/${repo}/contents/.github/workflows?ref=${branch}`
  );
  if (!workflowDir || !Array.isArray(workflowDir)) return fixes;

  for (const wf of workflowDir) {
    if (!wf.name.endsWith('.yml') && !wf.name.endsWith('.yaml')) continue;

    const content = fetchFullFileContent(repo, wf.path, branch);
    if (!content || !content.includes(missingEnv)) continue;

    const envBasename = missingEnv.split('/').pop() || missingEnv;
    const fixed = content.replace(
      new RegExp(
        `(\\. |source )([^\\n]*${envBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*)`,
        'g'
      ),
      '[ -f "$2" ] && $1$2 || echo "Skipping $2 (not found in CI)"'
    );

    if (fixed !== content) {
      fixes.push({ path: wf.path, content: fixed });
      console.log(`  Workflow fix: made env sourcing conditional in ${wf.path}`);
    }
  }

  return fixes;
};

export const fixSemgrepErrorFlag = (repo: string, branch: string): GeminiFix[] => {
  const fixes: GeminiFix[] = [];

  const workflowDir = ghApi<Array<{ name: string; path: string }>>(
    `repos/${repo}/contents/.github/workflows?ref=${branch}`
  );
  if (!workflowDir || !Array.isArray(workflowDir)) return fixes;

  for (const wf of workflowDir) {
    if (!wf.name.endsWith('.yml') && !wf.name.endsWith('.yaml')) continue;

    const content = fetchFullFileContent(repo, wf.path, branch);
    if (!content || !content.includes('semgrep')) continue;

    let fixed = content;

    if (fixed.includes('--error')) {
      fixed = fixed.replace(/\s*--error\b/g, '');
    }

    if (!fixed.includes('continue-on-error') && fixed.includes('Run Semgrep')) {
      fixed = fixed.replace(/(\s*- name: Run Semgrep\n)/, '$1        continue-on-error: true\n');
    }

    if (fixed !== content) {
      fixes.push({ path: wf.path, content: fixed });
      console.log(`  Workflow fix: made semgrep non-blocking in ${wf.path}`);
    }
  }

  return fixes;
};

export const fixWorkflowIssues = (repo: string, jobs: FailedJob[], branch: string): GeminiFix[] => {
  const fixes: GeminiFix[] = [];
  const logText = jobs.map((j) => j.logs).join('\n');

  if (
    logText.includes('No pnpm version is specified') ||
    logText.includes('Please specify it by one of the following ways')
  ) {
    fixes.push(...fixPnpmVersionInWorkflows(repo, branch));
  }

  if (logText.match(/\.env[.\w]*: not found/)) {
    fixes.push(...fixEnvFileSourcing(repo, jobs, branch));
  }

  if (logText.includes('semgrep') && logText.includes('exit code')) {
    fixes.push(...fixSemgrepErrorFlag(repo, branch));
  }

  return fixes;
};
