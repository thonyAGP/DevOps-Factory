import { MAX_LOG_LINES } from './constants.js';
import { ghApi, fetchFullFileContent } from './github-api.js';
import type { Annotation, FailedJob, GeminiFix } from './types.js';
import { sh as _sh } from '../shell-utils.js';

const sh = (cmd: string, timeout = 60_000) => _sh(cmd, { timeout });

/** Strip CI runner absolute prefixes to get repo-relative paths. */
export const normalizeLogPath = (p: string): string => {
  const linux = p.match(/home\/runner\/work\/[^/]+\/[^/]+\/(.*)/);
  if (linux) return linux[1];
  const win = p.match(/[A-Za-z]\/a\/[^/]+\/[^/]+\/(.*)/);
  if (win) return win[1];
  const winBack = p.match(/[A-Za-z]:\\a\\[^\\]+\\[^\\]+\\(.*)/);
  if (winBack) return winBack[1].replace(/\\/g, '/');
  return p;
};

export const getFailedJobs = (repo: string, runId: string): FailedJob[] => {
  console.log('Fetching failed jobs...');

  const data = ghApi<{ jobs: { id: number; name: string; conclusion: string }[] }>(
    `repos/${repo}/actions/runs/${runId}/jobs?per_page=30`
  );

  if (!data?.jobs) return [];

  const failedJobs = data.jobs.filter((j) => j.conclusion === 'failure');
  console.log(`  ${failedJobs.length} failed job(s): ${failedJobs.map((j) => j.name).join(', ')}`);

  const allLogs = sh(`gh run view ${runId} --repo ${repo} --log-failed`);

  return failedJobs.map((job) => {
    const raw = ghApi<Annotation[] | Record<string, unknown>>(
      `repos/${repo}/check-runs/${job.id}/annotations`
    );
    const annotations = Array.isArray(raw) ? raw : [];
    const errors = annotations.filter((a) => a.annotation_level === 'failure');

    const jobPrefix = job.name + '\t';
    const jobLogs = allLogs
      .split('\n')
      .filter((l) => l.startsWith(jobPrefix))
      .slice(-MAX_LOG_LINES)
      .join('\n');

    if (errors.length === 0 && jobLogs.length > 0) {
      const errorLinePattern =
        /##\[error\]([\w/.+:\\-]+\.(?:cs|ts|tsx|js|jsx))\((\d+),\d+\):\s*error\s+(\w+):\s*(.+?)(?:\s+\[|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = errorLinePattern.exec(jobLogs)) !== null) {
        const path = normalizeLogPath(m[1]);
        errors.push({
          path,
          start_line: Number(m[2]),
          end_line: Number(m[2]),
          annotation_level: 'failure',
          message: `${m[3]}: ${m[4].trim()}`,
        });
      }
      if (errors.length > 0) {
        console.log(`  [${job.name}] Synthesized ${errors.length} annotation(s) from logs`);
      }
    }

    console.log(
      `  [${job.name}] ${errors.length} error(s), ${jobLogs.split('\n').length} log lines`
    );

    return { id: job.id, name: job.name, annotations: errors, logs: jobLogs };
  });
};

export const getAnnotatedFiles = (jobs: FailedJob[]): Set<string> => {
  const files = new Set<string>();
  for (const job of jobs) {
    for (const a of job.annotations) {
      if (a.path) files.add(a.path);
    }
  }
  return files;
};

export const findClassBoundaries = (
  content: string,
  className: string
): { startLine: number; endLine: number } | null => {
  const lines = content.split('\n');

  const classIdx = lines.findIndex((l) => l.includes(`class ${className}`));
  if (classIdx === -1) return null;

  let startLine = classIdx;
  while (startLine > 0) {
    const prev = lines[startLine - 1].trim();
    if (prev.startsWith('///') || prev.startsWith('[') || prev === '') {
      startLine--;
    } else {
      break;
    }
  }

  let braceCount = 0;
  let endLine = classIdx;
  for (let i = classIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    endLine = i;
    if (braceCount === 0 && i > classIdx) break;
  }

  return { startLine, endLine };
};

export const searchFileForClass = (
  repo: string,
  path: string,
  className: string,
  branch: string
): string | null => {
  const decoded = fetchFullFileContent(repo, path, branch);
  if (!decoded) return null;

  const bounds = findClassBoundaries(decoded, className);
  if (!bounds) return null;

  const lines = decoded.split('\n');
  const contextStart = Math.max(0, bounds.startLine - 5);

  console.log(
    `  Found '${className}' in ${path} at lines ${bounds.startLine + 1}-${bounds.endLine + 1} (of ${lines.length})`
  );

  return (
    `// File: ${path} (lines ${contextStart + 1}-${bounds.endLine + 1} of ${lines.length})\n` +
    lines.slice(contextStart, bounds.endLine + 1).join('\n')
  );
};

export const getErrorSignature = (jobs: FailedJob[]): string => {
  const annotation = jobs
    .flatMap((j) => j.annotations)
    .find((a) => a.message && a.message.length > 10);
  if (annotation) {
    return annotation.message.slice(0, 80);
  }

  for (const job of jobs) {
    const lines = job.logs.split('\n');
    for (const line of lines) {
      if (/error\s+(TS|CS|MSB|ERR_)/i.test(line)) {
        return line.trim().slice(0, 80);
      }
    }
  }

  return 'unknown-error';
};

export const isLikelyFlaky = (jobs: FailedJob[]): boolean => {
  const flakyPatterns = [
    'ETIMEDOUT',
    'ECONNRESET',
    'socket hang up',
    'TimeoutError',
    'Navigation timeout',
    'Waiting for selector',
    'flaky',
    'ENOSPC',
  ];
  return jobs.some((j) => flakyPatterns.some((p) => j.logs.includes(p)));
};

export const canAutoFixPrettier = (jobs: FailedJob[]): boolean => {
  return jobs.some(
    (j) =>
      (j.name.toLowerCase().includes('quality') || j.name.toLowerCase().includes('lint')) &&
      j.logs.includes('Run Prettier with --write to fix')
  );
};

export const canAutoFixLockfile = (jobs: FailedJob[]): boolean => {
  return jobs.some(
    (j) =>
      j.logs.includes('ERR_PNPM_OUTDATED_LOCKFILE') ||
      j.logs.includes('npm warn old lockfile') ||
      j.logs.includes('Your lockfile needs to be updated') ||
      j.logs.includes('--frozen-lockfile')
  );
};

export const removeDuplicateClass = (
  repo: string,
  path: string,
  className: string,
  branch: string
): GeminiFix | null => {
  const content = fetchFullFileContent(repo, path, branch);
  if (!content) return null;

  const bounds = findClassBoundaries(content, className);
  if (!bounds) return null;

  const lines = content.split('\n');
  console.log(
    `  Removing '${className}' from ${path} (lines ${bounds.startLine + 1}-${bounds.endLine + 1} of ${lines.length})`
  );

  const before = lines.slice(0, bounds.startLine);
  const after = lines.slice(bounds.endLine + 1);

  while (
    before.length > 0 &&
    before[before.length - 1].trim() === '' &&
    after.length > 0 &&
    after[0].trim() === ''
  ) {
    after.shift();
  }

  const fixed = [...before, ...after].join('\n');

  const removedLines = bounds.endLine - bounds.startLine + 1;
  if (removedLines > lines.length * 0.5) {
    console.warn(
      `  Safety: class is ${removedLines}/${lines.length} lines (>50%) - skipping deterministic fix`
    );
    return null;
  }

  return { path, content: fixed };
};

export const findDuplicateDefinitionSiblings = (
  repo: string,
  jobs: FailedJob[],
  branch: string
): Map<string, string[]> => {
  const result = new Map<string, string[]>();

  for (const job of jobs) {
    for (const a of job.annotations) {
      const duplicateMatch = a.message.match(/already contains a definition for '(\w+)'/);
      if (!duplicateMatch) continue;

      const className = duplicateMatch[1];
      const dir = a.path.substring(0, a.path.lastIndexOf('/'));

      console.log(`  Duplicate '${className}' detected - scanning ${dir}/`);

      const siblings = ghApi<{ name: string; path: string; size: number }[]>(
        `repos/${repo}/contents/${dir}?ref=${branch}`
      );

      if (!siblings) continue;

      const siblingPaths = siblings
        .filter(
          (s) =>
            s.name.endsWith('.cs') ||
            s.name.endsWith('.ts') ||
            s.name.endsWith('.tsx') ||
            s.name.endsWith('.js')
        )
        .filter((s) => s.path !== a.path)
        .filter((s) => s.size < 300_000)
        .map((s) => s.path);

      result.set(className, siblingPaths);
    }
  }

  return result;
};

export const fixAmbiguousReferenceDuplicates = (
  repo: string,
  jobs: FailedJob[],
  branch: string
): GeminiFix[] => {
  const fixes: GeminiFix[] = [];
  const processed = new Set<string>();

  const allAnnotations = jobs.flatMap((j) => j.annotations);
  const ambiguousCount = allAnnotations.filter((a) =>
    a.message.includes('is an ambiguous reference between')
  ).length;
  if (ambiguousCount > 0)
    console.log(`  Found ${ambiguousCount} ambiguous reference annotation(s)`);

  for (const job of jobs) {
    for (const a of job.annotations) {
      const match = a.message.match(
        /'(\w+)' is an ambiguous reference between '([\w.]+)' and '([\w.]+)'/
      );
      if (!match) continue;

      const className = match[1];
      if (processed.has(className)) continue;
      processed.add(className);

      const fqn1 = match[2];
      const fqn2 = match[3];
      console.log(`  CS0104: '${className}' ambiguous between ${fqn1} and ${fqn2}`);

      const tree = ghApi<{ tree: { path: string; type: string }[] }>(
        `repos/${repo}/git/trees/${branch}?recursive=1`
      );
      if (!tree?.tree) continue;

      const standaloneFile = tree.tree.find(
        (f) => f.type === 'blob' && f.path.endsWith(`/${className}.cs`)
      );
      if (!standaloneFile) {
        console.log(`    No standalone ${className}.cs found`);
        continue;
      }
      console.log(`    Standalone: ${standaloneFile.path}`);

      const ns1Last = fqn1.split('.').slice(-2, -1)[0];
      const ns2Last = fqn2.split('.').slice(-2, -1)[0];
      const standaloneInNs1 = standaloneFile.path.includes(`/${ns1Last}/`);
      const otherNsSegment = standaloneInNs1 ? ns2Last : ns1Last;

      const standaloneDir = standaloneFile.path.substring(0, standaloneFile.path.lastIndexOf('/'));
      const otherDir = standaloneDir.replace(/\/[^/]+$/, `/${otherNsSegment}`);

      const otherFiles = tree.tree.filter(
        (f) =>
          f.type === 'blob' &&
          f.path.startsWith(otherDir + '/') &&
          f.path.endsWith('.cs') &&
          !f.path.endsWith(`/${className}.cs`)
      );
      console.log(`    Searching ${otherFiles.length} files in ${otherDir}/`);

      for (const otherFile of otherFiles) {
        const otherContent = fetchFullFileContent(repo, otherFile.path, branch);
        if (!otherContent || !otherContent.includes(`class ${className}`)) continue;

        const otherBounds = findClassBoundaries(otherContent, className);
        if (!otherBounds) continue;

        const standaloneContent = fetchFullFileContent(repo, standaloneFile.path, branch);
        if (!standaloneContent) continue;

        const standaloneBounds = findClassBoundaries(standaloneContent, className);
        if (!standaloneBounds) continue;

        const standaloneLines = standaloneContent.split('\n');
        const otherLines = otherContent.split('\n');

        const normalize = (s: string) =>
          s
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const standaloneClass = normalize(
          standaloneLines.slice(standaloneBounds.startLine, standaloneBounds.endLine + 1).join('\n')
        );
        const otherClass = normalize(
          otherLines.slice(otherBounds.startLine, otherBounds.endLine + 1).join('\n')
        );

        if (standaloneClass === otherClass) {
          console.log(`    Identical duplicate in ${otherFile.path} - removing`);
          const fix = removeDuplicateClass(repo, otherFile.path, className, branch);
          if (fix) fixes.push(fix);
        } else {
          console.log(`    Definitions differ in ${otherFile.path} - skipping`);
        }
        break;
      }
    }
  }

  return fixes;
};
