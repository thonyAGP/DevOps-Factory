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

const addNewPattern = (signature: string, fix: string, repo: string): void => {
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
};

// --- Claude CLI (Max plan fallback) ---

const askClaude = (jobs: FailedJob[], files: Map<string, string>): GeminiResponse => {
  const prompt = buildPrompt(jobs, files);
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
    // Get structured annotations
    const annotations = ghApi<Annotation[]>(`repos/${repo}/check-runs/${job.id}/annotations`) || [];
    const errors = annotations.filter((a) => a.annotation_level === 'failure');

    // Extract logs for this specific job (format: "JobName\tStep\tMessage")
    const jobPrefix = job.name + '\t';
    const jobLogs = allLogs
      .split('\n')
      .filter((l) => l.startsWith(jobPrefix))
      .slice(-MAX_LOG_LINES)
      .join('\n');

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
- Focus on BUILD/COMPILE errors first (ignore formatting/prettier issues)
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
  files: Map<string, string>
): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    return { fixes: [], explanation: 'Missing GEMINI_API_KEY' };
  }

  const prompt = buildPrompt(jobs, files);

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

const createFixPR = (
  repo: string,
  branch: string,
  baseBranch: string,
  runId: string,
  explanation: string
): string => {
  const title = 'fix: AI-generated CI fix';
  const body = `## AI-Generated CI Fix

**Failed Run**: https://github.com/${repo}/actions/runs/${runId}
**Generated by**: DevOps Factory Self-Healing (Gemini 2.5 Flash)

### Analysis
${explanation}

---
> This PR was automatically generated. Please review carefully before merging.
> Label: \`ai-fix\``;

  const prUrl = sh(
    `gh pr create --repo ${repo} --head ${branch} --base ${baseBranch} --title "${title}" --body "${body.replace(/"/g, '\\"')}" --label "ai-fix"`
  );

  if (prUrl.includes('https://')) {
    return prUrl.match(/(https:\/\/[^\s]+)/)?.[1] || prUrl;
  }

  // Label might not exist, try without
  const prUrl2 = sh(
    `gh pr create --repo ${repo} --head ${branch} --base ${baseBranch} --title "${title}" --body "${body.replace(/"/g, '\\"')}"`
  );

  return prUrl2.match(/(https:\/\/[^\s]+)/)?.[1] || prUrl2;
};

const createIssue = (repo: string, runId: string, explanation: string): void => {
  const title = `CI failure requires manual fix (run #${runId})`;
  const body = `## CI Failure - Manual Intervention Needed

**Failed Run**: https://github.com/${repo}/actions/runs/${runId}
**Analyzed by**: DevOps Factory Self-Healing (Gemini 2.5 Flash)

### Analysis
${explanation}

### Why no auto-fix?
The AI could not generate a reliable fix for this failure. Manual investigation is required.

---
> Generated by DevOps Factory`;

  sh(
    `gh issue create --repo ${repo} --title "${title}" --body "${body.replace(/"/g, '\\"')}" --label "ci-failure"`
  );

  console.log(`Issue created on ${repo}`);
};

// --- Main ---

const main = async (): Promise<void> => {
  const { repo, runId } = parseArgs();
  console.log(`\nSelf-Healing CI for ${repo} (run #${runId})\n`);

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
    console.log('\nOnly Prettier formatting errors detected.');
    console.log('Use DevOps-Factory auto-fix-prettier workflow instead.');
    createIssue(
      repo,
      runId,
      'CI failure is Prettier formatting only. Run `prettier --write .` to fix.'
    );
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

  // 3. If we have deterministic fixes, apply them directly (no Gemini needed)
  const allFixes: GeminiFix[] = [...deterministicFixes];
  let explanation = '';

  if (deterministicFixes.length > 0) {
    explanation = deterministicFixes
      .map((f) => `Removed duplicate class definition from ${f.path}`)
      .join('. ');
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

  if (hasNonDuplicateErrors && fileContents.size > 0) {
    // Step 4a: Check pattern database first (free, instant)
    const matchedPattern = matchPattern(targetJobs);

    if (matchedPattern && matchedPattern.fixType !== 'ai-required') {
      console.log(`\nPattern DB hit: "${matchedPattern.id}" - ${matchedPattern.fix}`);
      if (explanation) explanation += '. ';
      explanation += `Known pattern: ${matchedPattern.fix}`;
      recordPatternHit(matchedPattern.id, repo, true);
    } else {
      // Step 4b: Try Claude CLI first (Max plan tokens)
      console.log(`\nTotal files for AI analysis: ${fileContents.size}`);
      let aiResponse: GeminiResponse = { fixes: [], explanation: '' };

      const claudeResponse = askClaude(targetJobs, fileContents);
      if (claudeResponse.fixes.length > 0) {
        console.log(`Claude: ${claudeResponse.explanation}`);
        aiResponse = claudeResponse;
      } else {
        // Step 4c: Fall back to Gemini
        console.log('Claude unavailable/empty, falling back to Gemini...');
        aiResponse = await askGemini(targetJobs, fileContents);
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

      // Register new pattern if fix succeeded and error signature is identifiable
      if (aiResponse.fixes.length > 0) {
        const firstError = targetJobs
          .flatMap((j) => j.annotations)
          .find(
            (a) =>
              !a.message.includes('already contains a definition') &&
              !a.message.includes('already defines a member')
          );
        if (firstError) {
          const sig = firstError.message.slice(0, 80);
          addNewPattern(sig, aiResponse.explanation.slice(0, 200), repo);
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

  const prUrl = createFixPR(repo, branchName, defaultBranch, runId, explanation);
  console.log(`\nDone! PR: ${prUrl}`);
};

main().catch((err) => {
  console.error('Self-heal failed:', err);
  process.exit(1);
});
