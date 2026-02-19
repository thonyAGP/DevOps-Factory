/**
 * self-heal.ts
 *
 * Analyzes CI failures using pattern database + Claude/Gemini and creates fix PRs.
 * Priority: Pattern DB (free, instant) → Claude via CLI (Max plan) → Gemini Flash (fallback)
 *
 * Uses GitHub annotations API for structured errors + sibling file search
 * for context discovery. Works entirely via GitHub API (no local clone).
 *
 * Run: pnpm self-heal -- --repo owner/name --run-id 123456
 * Trigger: workflow_dispatch from dashboard-build or manual
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_LOG_LINES = 400;
const MAX_FILE_SIZE = 50_000;

// --- Types ---

interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
}

interface FailedJob {
  id: number;
  name: string;
  annotations: Annotation[];
  logs: string;
}

interface GeminiFix {
  path: string;
  content: string;
}

interface GeminiResponse {
  fixes: GeminiFix[];
  explanation: string;
}

interface Pattern {
  id: string;
  category: string;
  signature: string;
  fix: string;
  fixType: string;
  repos_seen: string[];
  occurrences: number;
  confidence: number;
}

interface PatternDB {
  version: number;
  lastUpdated: string;
  patterns: Pattern[];
}

const PATTERN_DB_PATH = 'data/patterns.json';
const PATTERN_CONFIDENCE_THRESHOLD = 0.8;

/** Strip CI runner absolute prefixes to get repo-relative paths.
 * Linux:   /home/runner/work/{repo}/{repo}/actual/path → actual/path
 * Windows: D:\a\{repo}\{repo}\actual\path → actual/path */
const normalizeLogPath = (p: string): string => {
  // Linux GitHub Actions: home/runner/work/{anything}/{anything}/rest
  const linux = p.match(/home\/runner\/work\/[^/]+\/[^/]+\/(.*)/);
  if (linux) return linux[1];
  // Windows GitHub Actions: D/a/{anything}/{anything}/rest (forward-slashed)
  const win = p.match(/[A-Za-z]\/a\/[^/]+\/[^/]+\/(.*)/);
  if (win) return win[1];
  // Windows backslash variant (already converted to forward slashes)
  const winBack = p.match(/[A-Za-z]:\\a\\[^\\]+\\[^\\]+\\(.*)/);
  if (winBack) return winBack[1].replace(/\\/g, '/');
  return p;
};

// --- Pattern Database ---

const loadPatterns = (): PatternDB => {
  if (!existsSync(PATTERN_DB_PATH)) return { version: 1, lastUpdated: '', patterns: [] };
  try {
    return JSON.parse(readFileSync(PATTERN_DB_PATH, 'utf-8')) as PatternDB;
  } catch {
    return { version: 1, lastUpdated: '', patterns: [] };
  }
};

const matchPattern = (jobs: FailedJob[]): Pattern | null => {
  const db = loadPatterns();
  const allMessages = jobs.flatMap((j) => [...j.annotations.map((a) => a.message), j.logs]);

  for (const pattern of db.patterns) {
    if (pattern.confidence < PATTERN_CONFIDENCE_THRESHOLD) continue;
    if (allMessages.some((msg) => msg.includes(pattern.signature))) {
      console.log(`  Pattern matched: ${pattern.id} (confidence: ${pattern.confidence})`);
      return pattern;
    }
  }

  return null;
};

const recordPatternHit = (patternId: string, repo: string, success: boolean): void => {
  const db = loadPatterns();
  const pattern = db.patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  pattern.occurrences++;
  if (!pattern.repos_seen.includes(repo)) {
    pattern.repos_seen.push(repo);
  }
  pattern.confidence = success
    ? Math.min(1, pattern.confidence + 0.05)
    : Math.max(0, pattern.confidence - 0.1);
  db.lastUpdated = new Date().toISOString();

  writeFileSync(PATTERN_DB_PATH, JSON.stringify(db, null, 2));
};

const matchedPatternConfidence = (patternId: string): number => {
  const db = loadPatterns();
  return db.patterns.find((p) => p.id === patternId)?.confidence ?? 0;
};

const addNewPattern = (signature: string, fix: string, repo: string): string => {
  const db = loadPatterns();
  const id = `auto-${Date.now()}`;
  db.patterns.push({
    id,
    category: 'ci-failure',
    signature,
    fix,
    fixType: 'ai-generated',
    repos_seen: [repo],
    occurrences: 1,
    confidence: 0.5,
  });
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PATTERN_DB_PATH, JSON.stringify(db, null, 2));
  console.log(`  New pattern registered: ${id}`);
  return id;
};

// --- Claude CLI (Max plan fallback) ---

const askClaude = (
  jobs: FailedJob[],
  files: Map<string, string>,
  patternHint = ''
): GeminiResponse => {
  const prompt = buildPrompt(jobs, files) + patternHint;
  console.log(`Asking Claude CLI (prompt: ${Math.round(prompt.length / 1024)}KB)...`);

  try {
    const result = execSync('claude -p --output-format text', {
      input: prompt,
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Try to extract JSON from Claude's response
    const jsonMatch = result.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as GeminiResponse;
      } catch {
        // fall through
      }
    }

    return { fixes: [], explanation: `Claude response (non-JSON): ${result.slice(0, 500)}` };
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`Claude CLI failed: ${err.message?.slice(0, 200)}`);
    return { fixes: [], explanation: 'Claude CLI unavailable' };
  }
};

// --- Shell helpers ---

const parseArgs = (): { repo: string; runId: string } => {
  const args = process.argv.slice(2);
  let repo = '';
  let runId = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
    if (args[i] === '--run-id' && args[i + 1]) runId = args[i + 1];
  }

  if (!repo || !runId) {
    console.error('Usage: tsx scripts/self-heal.ts --repo owner/name --run-id 123456');
    process.exit(1);
  }

  return { repo, runId };
};

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return err.stdout?.trim() || err.stderr?.trim() || '';
  }
};

const ghApi = <T>(endpoint: string): T | null => {
  const raw = sh(`gh api ${endpoint}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// --- Step 1: Structured error collection ---

const getFailedJobs = (repo: string, runId: string): FailedJob[] => {
  console.log('Fetching failed jobs...');

  const data = ghApi<{ jobs: { id: number; name: string; conclusion: string }[] }>(
    `repos/${repo}/actions/runs/${runId}/jobs?per_page=30`
  );

  if (!data?.jobs) return [];

  const failedJobs = data.jobs.filter((j) => j.conclusion === 'failure');
  console.log(`  ${failedJobs.length} failed job(s): ${failedJobs.map((j) => j.name).join(', ')}`);

  // Fetch raw logs once (separated by job later)
  const allLogs = sh(`gh run view ${runId} --repo ${repo} --log-failed`);

  return failedJobs.map((job) => {
    // Get structured annotations (API may return object on 403 instead of array)
    const raw = ghApi<Annotation[] | Record<string, unknown>>(
      `repos/${repo}/check-runs/${job.id}/annotations`
    );
    const annotations = Array.isArray(raw) ? raw : [];
    const errors = annotations.filter((a) => a.annotation_level === 'failure');

    // Extract logs for this specific job (format: "JobName\tStep\tMessage")
    const jobPrefix = job.name + '\t';
    const jobLogs = allLogs
      .split('\n')
      .filter((l) => l.startsWith(jobPrefix))
      .slice(-MAX_LOG_LINES)
      .join('\n');

    // Fallback: synthesize annotations from ##[error] lines when API returns 403
    if (errors.length === 0 && jobLogs.length > 0) {
      const errorLinePattern =
        /##\[error\]([\w/.+:\\-]+\.(?:cs|ts|tsx|js|jsx))\((\d+),\d+\):\s*error\s+\w+:\s*(.+?)(?:\s+\[|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = errorLinePattern.exec(jobLogs)) !== null) {
        const path = normalizeLogPath(m[1]);
        errors.push({
          path,
          start_line: Number(m[2]),
          end_line: Number(m[2]),
          annotation_level: 'failure',
          message: m[3].trim(),
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

// --- Step 2: Smart file discovery ---

/** Get files directly referenced in annotations */
const getAnnotatedFiles = (jobs: FailedJob[]): Set<string> => {
  const files = new Set<string>();
  for (const job of jobs) {
    for (const a of job.annotations) {
      if (a.path) files.add(a.path);
    }
  }
  return files;
};

/** For "duplicate definition" errors, find sibling files that may contain the duplicate */
const findDuplicateDefinitionSiblings = (
  repo: string,
  jobs: FailedJob[],
  branch: string
): Map<string, string[]> => {
  const result = new Map<string, string[]>();

  for (const job of jobs) {
    for (const a of job.annotations) {
      // CS0101: namespace already contains definition for 'X'
      // CS0111: type already defines member 'X'
      const duplicateMatch = a.message.match(/already contains a definition for '(\w+)'/);
      if (!duplicateMatch) continue;

      const className = duplicateMatch[1];
      const dir = a.path.substring(0, a.path.lastIndexOf('/'));

      console.log(`  Duplicate '${className}' detected - scanning ${dir}/`);

      // List sibling files in same directory
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
        .filter((s) => s.path !== a.path) // Exclude the file already in annotations
        .filter((s) => s.size < 300_000) // Skip huge files for full content
        .map((s) => s.path);

      result.set(className, siblingPaths);
    }
  }

  return result;
};

/** Fetch file content from GitHub, with optional line range for large files */
const fetchFileContent = (repo: string, path: string, branch: string): string | null => {
  const data = ghApi<{ content?: string; size?: number }>(
    `repos/${repo}/contents/${path}?ref=${branch}`
  );
  if (!data?.content) return null;

  try {
    const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    if (decoded.length > MAX_FILE_SIZE) {
      return decoded.slice(0, MAX_FILE_SIZE) + '\n// ... truncated ...';
    }
    return decoded;
  } catch {
    return null;
  }
};

/** Find class boundaries in a file. Returns { startLine, endLine } (0-indexed) or null */
const findClassBoundaries = (
  content: string,
  className: string
): { startLine: number; endLine: number } | null => {
  const lines = content.split('\n');

  const classIdx = lines.findIndex((l) => l.includes(`class ${className}`));
  if (classIdx === -1) return null;

  // Walk backwards to include XML doc comments and attributes
  let startLine = classIdx;
  while (startLine > 0) {
    const prev = lines[startLine - 1].trim();
    if (prev.startsWith('///') || prev.startsWith('[') || prev === '') {
      startLine--;
    } else {
      break;
    }
  }

  // Find end of class via brace matching
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

/** Search a large file for a class definition and return surrounding context (for Gemini) */
const searchFileForClass = (
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

/** Fetch full file content (no truncation) */
const fetchFullFileContent = (repo: string, path: string, branch: string): string | null => {
  const data = ghApi<{ content?: string }>(`repos/${repo}/contents/${path}?ref=${branch}`);
  if (!data?.content) return null;
  try {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  } catch {
    return null;
  }
};

/** Deterministic fix: remove a duplicate class from a file (no AI needed) */
const removeDuplicateClass = (
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

  // Remove the class and any trailing blank lines
  const before = lines.slice(0, bounds.startLine);
  const after = lines.slice(bounds.endLine + 1);

  // Clean up: remove excessive blank lines at the junction
  while (
    before.length > 0 &&
    before[before.length - 1].trim() === '' &&
    after.length > 0 &&
    after[0].trim() === ''
  ) {
    after.shift();
  }

  const fixed = [...before, ...after].join('\n');

  // Safety: verify we didn't remove too much (class should be <50% of file)
  const removedLines = bounds.endLine - bounds.startLine + 1;
  if (removedLines > lines.length * 0.5) {
    console.warn(
      `  Safety: class is ${removedLines}/${lines.length} lines (>50%) - skipping deterministic fix`
    );
    return null;
  }

  return { path, content: fixed };
};

// --- Step 3: Gemini analysis ---

const buildPrompt = (jobs: FailedJob[], files: Map<string, string>): string => {
  const errorsSection = jobs
    .map((j) => {
      const annots = j.annotations
        .map((a) => `  - ${a.path}:${a.start_line}: ${a.message}`)
        .join('\n');
      return `### ${j.name}\n${annots || '(no structured errors)'}`;
    })
    .join('\n\n');

  const logsSection = jobs
    .filter((j) => j.annotations.length === 0)
    .map((j) => `### ${j.name} (raw logs)\n\`\`\`\n${j.logs.slice(0, 3000)}\n\`\`\``)
    .join('\n\n');

  const filesSection = [...files.entries()]
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  return `You are a CI/CD fix assistant. Analyze the structured errors and source files below.

## Errors by Job
${errorsSection}

${logsSection ? `## Additional Logs\n${logsSection}\n` : ''}
## Source Files
${filesSection.slice(0, 60000)}

## Instructions
- Focus on BUILD/COMPILE errors first, but also fix formatting issues (trailing whitespace, missing blank lines) if present
- For "already contains a definition" errors: the class exists in TWO files. Remove the DUPLICATE (the one embedded in a larger file), keep the standalone file.
- Propose the MINIMAL fix (fewest lines changed)
- For large files where you only see a fragment: output ONLY the fragment that needs to change, with a clear "// ... rest of file unchanged ..." marker
- If you cannot fix it, return empty fixes with an explanation

## Response Format (JSON only)
{
  "fixes": [
    {
      "path": "relative/path/to/file.ext",
      "content": "full file content with fix applied"
    }
  ],
  "explanation": "Brief explanation of what was wrong and what was fixed"
}`;
};

const askGemini = async (
  jobs: FailedJob[],
  files: Map<string, string>,
  patternHint = ''
): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    return { fixes: [], explanation: 'Missing GEMINI_API_KEY' };
  }

  const prompt = buildPrompt(jobs, files) + patternHint;

  console.log(`Asking Gemini 2.5 Flash (prompt: ${Math.round(prompt.length / 1024)}KB)...`);

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini API error ${response.status}: ${errText}`);
    return { fixes: [], explanation: `Gemini API error: ${response.status}` };
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('No response from Gemini');
    return { fixes: [], explanation: 'Empty response from Gemini' };
  }

  try {
    return JSON.parse(text) as GeminiResponse;
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as GeminiResponse;
      } catch {
        // fall through
      }
    }
    console.error('Failed to parse Gemini response:', text.slice(0, 500));
    return { fixes: [], explanation: 'Could not parse Gemini response' };
  }
};

// --- Step 4: Handle Prettier (no AI needed) ---

const canAutoFixPrettier = (jobs: FailedJob[]): boolean => {
  return jobs.some(
    (j) =>
      (j.name.toLowerCase().includes('quality') || j.name.toLowerCase().includes('lint')) &&
      j.logs.includes('Run Prettier with --write to fix')
  );
};

// --- Step 5: Apply fixes ---

const getDefaultBranch = (repo: string): string => {
  const data = ghApi<{ default_branch?: string }>(`repos/${repo}`);
  return data?.default_branch || 'main';
};

const createBranch = (repo: string, branchName: string, baseBranch: string): boolean => {
  const data = ghApi<{ object?: { sha?: string } }>(`repos/${repo}/git/ref/heads/${baseBranch}`);
  const sha = data?.object?.sha;
  if (!sha) {
    console.error(`Could not get SHA for ${baseBranch}`);
    return false;
  }

  const result = sh(
    `gh api repos/${repo}/git/refs -f ref="refs/heads/${branchName}" -f sha="${sha}"`
  );

  return result.includes(branchName) || result.includes(sha);
};

/** Upload a file using the Git tree/commit API (handles large files, no shell length limits) */
const uploadFileViaBlobApi = (
  repo: string,
  branch: string,
  path: string,
  content: string,
  commitMessage: string
): boolean => {
  // 1. Create blob
  const contentBase64 = Buffer.from(content).toString('base64');
  const blobResult = sh(
    `gh api repos/${repo}/git/blobs -f content="${contentBase64}" -f encoding="base64"`
  );

  let blobSha: string;
  try {
    blobSha = (JSON.parse(blobResult) as { sha: string }).sha;
  } catch {
    // For very large content, use a temp file approach
    const tmpFile = `self-heal-blob-${Date.now()}.json`;
    writeFileSync(tmpFile, JSON.stringify({ content: contentBase64, encoding: 'base64' }));
    const blobResult2 = sh(`gh api repos/${repo}/git/blobs --input ${tmpFile}`);
    unlinkSync(tmpFile);
    try {
      blobSha = (JSON.parse(blobResult2) as { sha: string }).sha;
    } catch {
      console.error(`  Failed to create blob for ${path}`);
      return false;
    }
  }

  // 2. Get current branch tree
  const refData = ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${branch}`);
  if (!refData) return false;

  const commitData = ghApi<{ tree: { sha: string } }>(
    `repos/${repo}/git/commits/${refData.object.sha}`
  );
  if (!commitData) return false;

  // 3. Create new tree with the updated file
  const treeResult = sh(
    `gh api repos/${repo}/git/trees -f base_tree="${commitData.tree.sha}" -f "tree[][path]=${path}" -f "tree[][mode]=100644" -f "tree[][type]=blob" -f "tree[][sha]=${blobSha}"`
  );

  let treeSha: string;
  try {
    treeSha = (JSON.parse(treeResult) as { sha: string }).sha;
  } catch {
    console.error(`  Failed to create tree for ${path}`);
    return false;
  }

  // 4. Create commit
  const newCommitResult = sh(
    `gh api repos/${repo}/git/commits -f message="${commitMessage}" -f "tree=${treeSha}" -f "parents[]=${refData.object.sha}"`
  );

  let newCommitSha: string;
  try {
    newCommitSha = (JSON.parse(newCommitResult) as { sha: string }).sha;
  } catch {
    console.error(`  Failed to create commit for ${path}`);
    return false;
  }

  // 5. Update branch ref
  const updateResult = sh(
    `gh api repos/${repo}/git/refs/heads/${branch} -X PATCH -f sha="${newCommitSha}"`
  );

  return updateResult.includes(newCommitSha);
};

const applyFixes = (
  repo: string,
  branch: string,
  _baseBranch: string,
  fixes: GeminiFix[]
): boolean => {
  let success = true;

  for (const fix of fixes) {
    console.log(`  Applying fix to ${fix.path} (${Math.round(fix.content.length / 1024)}KB)...`);

    const ok = uploadFileViaBlobApi(
      repo,
      branch,
      fix.path,
      fix.content,
      'fix: AI-generated fix for CI failure'
    );

    if (!ok) {
      console.error(`  Failed to update ${fix.path}`);
      success = false;
    }
  }

  return success;
};

/** Deterministic fix for StyleCop: trailing whitespace (SA1028) and missing blank line (SA1513) */
const fixStyleCopIssues = (repo: string, jobs: FailedJob[], branch: string): GeminiFix[] => {
  const fixes: GeminiFix[] = [];
  const filesToFix = new Set<string>();

  for (const job of jobs) {
    for (const a of job.annotations) {
      if (a.message.includes('SA1028') || a.message.includes('SA1513')) {
        filesToFix.add(a.path);
      }
    }
  }

  for (const path of filesToFix) {
    const content = fetchFullFileContent(repo, path, branch);
    if (!content) continue;

    let fixed = content
      .split('\n')
      .map((line) => line.trimEnd()) // SA1028: remove trailing whitespace
      .join('\n');

    // SA1513: closing brace should be followed by blank line
    fixed = fixed.replace(/^(\s*\})\n(\s*[^\s\}])/gm, '$1\n\n$2');

    if (fixed !== content) {
      fixes.push({ path, content: fixed });
      console.log(`  StyleCop fix for ${path}`);
    }
  }

  return fixes;
};

/** Ensure a label exists on the repo (create if missing) */
const ensureLabel = (repo: string, label: string, color: string, description: string): void => {
  sh(
    `gh api "repos/${repo}/labels" -X POST -f name="${label}" -f color="${color}" -f description="${description}"`
  );
};

const createFixPR = (
  repo: string,
  branch: string,
  baseBranch: string,
  runId: string,
  explanation: string,
  patternId?: string
): string => {
  const title = patternId ? `fix: CI fix [pattern:${patternId}]` : 'fix: AI-generated CI fix';
  const source = patternId ? `Pattern DB (${patternId})` : 'AI analysis';
  const body = `## Auto-Generated CI Fix

**Failed Run**: https://github.com/${repo}/actions/runs/${runId}
**Generated by**: DevOps Factory Self-Healing
**Source**: ${source}
${patternId ? `**Pattern ID**: \`${patternId}\`` : ''}

### Analysis
${explanation}

---
> This PR was automatically generated. Please review carefully before merging.
> Label: \`ai-fix\``;

  ensureLabel(repo, 'ai-fix', '7057ff', 'Auto-generated fix by DevOps Factory');

  const prUrl = sh(
    `gh pr create --repo ${repo} --head ${branch} --base ${baseBranch} --title "${title}" --body "${body.replace(/"/g, '\\"')}" --label "ai-fix"`
  );

  return prUrl.match(/(https:\/\/[^\s]+)/)?.[1] || prUrl;
};

const createIssue = (repo: string, runId: string, explanation: string): void => {
  const title = `CI failure requires manual fix (run #${runId})`;
  const body = `## CI Failure - Manual Intervention Needed

**Failed Run**: https://github.com/${repo}/actions/runs/${runId}
**Analyzed by**: DevOps Factory Self-Healing

### Analysis
${explanation}

### Why no auto-fix?
The AI could not generate a reliable fix for this failure. Manual investigation is required.

---
> Generated by DevOps Factory`;

  ensureLabel(repo, 'ci-failure', 'e11d48', 'CI failure requiring manual fix');

  const escapedBody = body.replace(/"/g, '\\"');
  sh(
    `gh issue create --repo ${repo} --title "${title}" --body "${escapedBody}" --label "ci-failure"`
  );

  console.log(`Issue created on ${repo}`);
};

// --- Main ---

const main = async (): Promise<void> => {
  const { repo, runId } = parseArgs();
  console.log(`\nSelf-Healing CI for ${repo} (run #${runId})\n`);

  // 0. Anti-loop: skip if the failing run is on an ai-fix branch
  const runData = ghApi<{ head_branch?: string }>(`repos/${repo}/actions/runs/${runId}`);
  const headBranch = runData?.head_branch || '';
  if (headBranch.startsWith('ai-fix/')) {
    console.log(`Skipping: run is on branch "${headBranch}" (ai-fix loop prevention)`);
    return;
  }

  // 1. Get structured errors per failed job
  const jobs = getFailedJobs(repo, runId);
  if (jobs.length === 0) {
    console.log('No failed jobs found');
    return;
  }

  // Filter to build/compile/test jobs (skip formatting-only jobs)
  const buildJobs = jobs.filter(
    (j) => !j.name.toLowerCase().includes('quality') && !j.name.toLowerCase().includes('lint')
  );
  const hasPrettierOnly = buildJobs.length === 0 && canAutoFixPrettier(jobs);

  if (hasPrettierOnly) {
    console.log('\nOnly Prettier formatting errors detected - triggering auto-fix...');
    const factoryRepo = process.env.GITHUB_REPOSITORY || 'thonyAGP/DevOps-Factory';
    const triggerResult = sh(`gh workflow run auto-fix-prettier.yml --repo ${factoryRepo}`);
    console.log(triggerResult ? `  Triggered: ${triggerResult}` : '  Auto-fix-prettier triggered');
    return;
  }

  const targetJobs = buildJobs.length > 0 ? buildJobs : jobs;

  // 2. Collect files to send to Gemini
  const defaultBranch = getDefaultBranch(repo);
  console.log(`Default branch: ${defaultBranch}\n`);

  const fileContents = new Map<string, string>();

  // 2a. Files from annotations
  const annotatedFiles = getAnnotatedFiles(targetJobs);
  console.log(`Annotated files: ${[...annotatedFiles].join(', ')}`);

  for (const path of annotatedFiles) {
    const content = fetchFileContent(repo, path, defaultBranch);
    if (content) {
      fileContents.set(path, content);
      console.log(`  Fetched ${path} (${Math.round(content.length / 1024)}KB)`);
    }
  }

  // 2b. Deterministic fixes for duplicate definitions (no AI needed)
  const deterministicFixes: GeminiFix[] = [];
  const duplicateSiblings = findDuplicateDefinitionSiblings(repo, targetJobs, defaultBranch);

  for (const [className, siblingPaths] of duplicateSiblings) {
    for (const sibPath of siblingPaths) {
      // Check if sibling contains the duplicate class
      const fragment = searchFileForClass(repo, sibPath, className, defaultBranch);
      if (!fragment) continue;

      // Deterministic fix: remove the class from the larger file
      const fix = removeDuplicateClass(repo, sibPath, className, defaultBranch);
      if (fix) {
        deterministicFixes.push(fix);
        console.log(`  Deterministic fix ready for ${sibPath}`);
      } else {
        // Fallback: add fragment to Gemini context
        fileContents.set(sibPath, fragment);
      }
    }
  }

  // 2c. Deterministic fixes for StyleCop (SA1028 trailing whitespace, SA1513 blank lines)
  const stylecopFixes = fixStyleCopIssues(repo, targetJobs, defaultBranch);
  deterministicFixes.push(...stylecopFixes);

  // 3. If we have deterministic fixes, apply them directly (no AI needed)
  const allFixes: GeminiFix[] = [...deterministicFixes];
  let usedPatternId: string | undefined;
  let explanation = '';

  if (deterministicFixes.length > 0) {
    const parts: string[] = [];
    const dupFixes = deterministicFixes.filter((f) => !stylecopFixes.includes(f));
    if (dupFixes.length > 0)
      parts.push(dupFixes.map((f) => `Removed duplicate class from ${f.path}`).join('. '));
    if (stylecopFixes.length > 0)
      parts.push(`Fixed StyleCop issues in ${stylecopFixes.map((f) => f.path).join(', ')}`);
    explanation = parts.join('. ');
    console.log(`\nDeterministic fixes: ${deterministicFixes.length}`);
  }

  // 4. For remaining errors, try: Pattern DB → Claude CLI → Gemini
  const hasNonDuplicateErrors = targetJobs.some((j) =>
    j.annotations.some(
      (a) =>
        !a.message.includes('already contains a definition') &&
        !a.message.includes('already defines a member')
    )
  );

  // Also trigger analysis when we have logs but no annotations (403 on check-runs API)
  const hasLogsWithoutAnnotations =
    targetJobs.some((j) => j.logs.length > 0) &&
    targetJobs.every((j) => j.annotations.length === 0);

  if (hasLogsWithoutAnnotations && fileContents.size === 0) {
    // Extract file paths from log error messages using multiple CI-aware patterns
    const logText = targetJobs.map((j) => j.logs).join('\n');
    const extractedPaths = new Set<string>();

    // .NET/TS errors: /path/to/file.cs(line,col) or file.ts(line,col)
    const errorLocPattern = /([\w/.+:\\-]+\.(?:ts|tsx|js|jsx|cs))\(\d+/g;
    // csproj references: [/path/to/file.csproj]
    const csprojPattern = /\[([\w/.+:\\-]+\.csproj)\]/g;
    // General: whitespace-preceded path
    const generalPattern = /(?:^|\s)([\w/.+-]+\.(?:ts|tsx|js|jsx|cs|csproj))(?=[\s(:]|$)/gm;

    for (const pattern of [errorLocPattern, csprojPattern, generalPattern]) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(logText)) !== null) {
        const p = normalizeLogPath(match[1]);
        if (
          !p.startsWith('node_modules/') &&
          !p.startsWith('.github/') &&
          !p.startsWith('home/') &&
          !p.startsWith('usr/')
        ) {
          extractedPaths.add(p);
        }
      }
    }
    console.log(`  Extracted ${extractedPaths.size} file path(s) from logs`);
    for (const ep of extractedPaths) console.log(`    → ${ep}`);

    // Fetch up to 10 files for context
    for (const path of [...extractedPaths].slice(0, 10)) {
      const content = fetchFileContent(repo, path, defaultBranch);
      if (content) {
        fileContents.set(path, content);
        console.log(`  Fetched ${path} (${Math.round(content.length / 1024)}KB)`);
      }
    }
  }

  if (
    (hasNonDuplicateErrors || hasLogsWithoutAnnotations) &&
    (fileContents.size > 0 || hasLogsWithoutAnnotations)
  ) {
    // Step 4a: Check pattern database (enriches AI prompt if found)
    const matchedPattern = matchPattern(targetJobs);
    let patternHint = '';

    if (matchedPattern) {
      console.log(
        `\nPattern DB hit: "${matchedPattern.id}" (${matchedPattern.confidence}) - ${matchedPattern.fix}`
      );
      usedPatternId = matchedPattern.id;
      patternHint = `\n\n## Known Pattern\nThis error matches known pattern "${matchedPattern.id}".\nKnown fix: ${matchedPattern.fix}\nApply this fix approach to the source files below.\n`;
    }

    // Step 4b: Send to AI for code generation (pattern hint guides the fix)
    console.log(`\nTotal files for AI analysis: ${fileContents.size}`);
    let aiResponse: GeminiResponse = { fixes: [], explanation: '' };

    const claudeResponse = askClaude(targetJobs, fileContents, patternHint);
    if (claudeResponse.fixes.length > 0) {
      console.log(`Claude: ${claudeResponse.explanation}`);
      aiResponse = claudeResponse;
    } else {
      // Step 4c: Fall back to Gemini
      console.log('Claude unavailable/empty, falling back to Gemini...');
      aiResponse = await askGemini(targetJobs, fileContents, patternHint);
      console.log(`Gemini: ${aiResponse.explanation}`);
    }

    // Safety: reject AI fixes that look suspicious (>50% content change)
    for (const fix of aiResponse.fixes) {
      const original = fetchFullFileContent(repo, fix.path, defaultBranch);
      if (original && fix.content.length < original.length * 0.3) {
        console.warn(
          `  Rejected fix for ${fix.path}: content is ${Math.round((fix.content.length / original.length) * 100)}% of original (likely truncated)`
        );
        continue;
      }
      allFixes.push(fix);
    }

    if (explanation) explanation += '. ';
    explanation += aiResponse.explanation;

    // Update pattern tracking
    if (matchedPattern) {
      recordPatternHit(matchedPattern.id, repo, aiResponse.fixes.length > 0);
    } else if (aiResponse.fixes.length > 0) {
      // Register new pattern from AI fix
      const firstError = targetJobs
        .flatMap((j) => j.annotations)
        .find(
          (a) =>
            !a.message.includes('already contains a definition') &&
            !a.message.includes('already defines a member')
        );
      if (firstError) {
        usedPatternId = addNewPattern(
          firstError.message.slice(0, 80),
          aiResponse.explanation.slice(0, 200),
          repo
        );
      } else if (hasLogsWithoutAnnotations) {
        const errorLine = targetJobs
          .flatMap((j) => j.logs.split('\n'))
          .find((l) => /error\s+(TS|CS|MSB)/i.test(l));
        if (errorLine) {
          usedPatternId = addNewPattern(
            errorLine.trim().slice(0, 80),
            aiResponse.explanation.slice(0, 200),
            repo
          );
        }
      }
    }
  }

  // 5. Apply or create issue
  if (allFixes.length === 0) {
    console.log('\nNo fixes found - creating issue...');
    createIssue(repo, runId, explanation || 'Could not determine a fix');
    return;
  }

  const branchName = `ai-fix/ci-${Date.now()}`;
  console.log(`\nCreating branch: ${branchName}`);

  if (!createBranch(repo, branchName, defaultBranch)) {
    console.error('Failed to create branch');
    createIssue(repo, runId, explanation);
    return;
  }

  console.log('Applying fixes...');
  applyFixes(repo, branchName, defaultBranch, allFixes);

  const prUrl = createFixPR(repo, branchName, defaultBranch, runId, explanation, usedPatternId);
  console.log(`\nPR created: ${prUrl}`);

  // Auto-merge small fixes from high-confidence patterns
  const totalLinesChanged = allFixes.reduce((sum, f) => sum + f.content.split('\n').length, 0);
  const isSmallFix = allFixes.length <= 3 && totalLinesChanged <= 200;
  const isHighConfidencePattern = usedPatternId && matchedPatternConfidence(usedPatternId) >= 0.9;

  if (isSmallFix && isHighConfidencePattern) {
    console.log(
      `  Small fix (${totalLinesChanged} lines) from trusted pattern - enabling auto-merge`
    );
    const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
    if (prNumber) {
      // Enable auto-merge (will merge when CI passes)
      sh(`gh pr merge ${prNumber} --repo ${repo} --auto --squash`);
      console.log(`  Auto-merge enabled for PR #${prNumber}`);
    }
  }

  console.log('\nDone!');
};

main().catch((err) => {
  console.error('Self-heal failed:', err);
  process.exit(1);
});
