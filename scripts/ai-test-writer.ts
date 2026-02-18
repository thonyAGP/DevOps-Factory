/**
 * ai-test-writer.ts
 *
 * AI-powered test generation using Claude CLI (Max plan tokens).
 * Finds source files without tests, sends code + context to Claude,
 * generates real test implementations, and creates PRs.
 *
 * Guards: max 5 files per repo per run, human review required.
 *
 * Run: pnpm ai-test-writer
 * Can target a single repo: pnpm ai-test-writer -- --repo thonyAGP/Email_Assistant
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { KNOWN_PROJECTS } from '../factory.config.js';

const MAX_FILES_PER_REPO = 5;
const MAX_SOURCE_SIZE = 30_000;
const AI_TIMEOUT = 180_000;
const QUOTA_PATH = 'data/ai-test-quota.json';

type AIProvider = 'groq' | 'gemini' | 'claude';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface TreeNode {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface GeneratedTest {
  testPath: string;
  sourcePath: string;
  content: string;
}

interface QuotaData {
  date: string;
  count: number;
  maxPerDay: number;
}

// --- Shell helpers ---

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
};

const ghApi = <T>(endpoint: string): T | null => {
  const raw = sh(`gh api "${endpoint}"`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// --- Quota ---

const getQuota = (): QuotaData => {
  if (!existsSync(QUOTA_PATH)) {
    return { date: new Date().toISOString().split('T')[0], count: 0, maxPerDay: 20 };
  }
  return JSON.parse(readFileSync(QUOTA_PATH, 'utf-8')) as QuotaData;
};

const consumeQuota = (n: number): boolean => {
  const quota = getQuota();
  const today = new Date().toISOString().split('T')[0];
  if (quota.date !== today) {
    quota.date = today;
    quota.count = 0;
  }
  if (quota.count + n > quota.maxPerDay) return false;
  quota.count += n;
  writeFileSync(QUOTA_PATH, JSON.stringify(quota, null, 2));
  return true;
};

// --- File discovery ---

const getRepoTree = (repo: string, branch: string): TreeNode[] => {
  const response = ghApi<{ tree: TreeNode[] }>(`repos/${repo}/git/trees/${branch}?recursive=1`);
  return response?.tree ?? [];
};

const isSourceFile = (path: string): boolean => {
  if (!/\.(ts|tsx)$/.test(path)) return false;
  if (!/^src\//.test(path)) return false;
  const skip = ['node_modules', '.next', 'dist', 'build', 'coverage', '__mocks__'];
  if (skip.some((d) => path.includes(`/${d}/`) || path.startsWith(`${d}/`))) return false;
  if (/\.(test|spec|d)\.(ts|tsx)$/.test(path)) return false;
  if (/\.(config|stories)\.(ts|tsx|js)$/.test(path)) return false;
  if (/\/index\.(ts|tsx)$/.test(path)) return false;
  return true;
};

const findUntested = (tree: TreeNode[]): string[] => {
  const blobs = tree.filter((n) => n.type === 'blob').map((n) => n.path);
  const blobSet = new Set(blobs);

  return blobs.filter((p) => {
    if (!isSourceFile(p)) return false;
    const ext = p.match(/\.(ts|tsx)$/)?.[0] ?? '.ts';
    const testPath = p.replace(/\.(ts|tsx)$/, `.test${ext}`);
    const specPath = p.replace(/\.(ts|tsx)$/, `.spec${ext}`);
    return !blobSet.has(testPath) && !blobSet.has(specPath);
  });
};

const fetchFile = (repo: string, path: string, branch: string): string | null => {
  const data = ghApi<{ content?: string; size?: number }>(
    `repos/${repo}/contents/${path}?ref=${branch}`
  );
  if (!data?.content) return null;
  try {
    const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    return decoded.length > MAX_SOURCE_SIZE
      ? decoded.slice(0, MAX_SOURCE_SIZE) + '\n// ... truncated ...'
      : decoded;
  } catch {
    return null;
  }
};

// --- Imports discovery ---

const findImports = (source: string, tree: TreeNode[], basePath: string): string[] => {
  const importPaths: string[] = [];
  const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(source)) !== null) {
    const raw = match[1];
    const dir = basePath.substring(0, basePath.lastIndexOf('/'));
    // Resolve relative import
    const resolved = raw.startsWith('./')
      ? `${dir}/${raw.slice(2)}`
      : raw.startsWith('../')
        ? resolveParent(dir, raw)
        : raw;

    // Try with extensions
    const blobPaths = tree.filter((n) => n.type === 'blob').map((n) => n.path);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const candidate = resolved + ext;
      if (blobPaths.includes(candidate)) {
        importPaths.push(candidate);
        break;
      }
    }
  }

  return importPaths.slice(0, 3); // Max 3 imports for context
};

const resolveParent = (dir: string, rel: string): string => {
  const parts = dir.split('/');
  const relParts = rel.split('/');
  for (const p of relParts) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
};

// --- Claude test generation ---

const buildTestPrompt = (
  sourcePath: string,
  sourceCode: string,
  imports: Map<string, string>
): string => {
  let context = '';
  if (imports.size > 0) {
    context = '\n## Imported modules (for type context)\n';
    for (const [path, code] of imports) {
      context += `\n### ${path}\n\`\`\`typescript\n${code.slice(0, 5000)}\n\`\`\`\n`;
    }
  }

  return `You are a test engineer. Write Vitest tests for the following TypeScript file.

## Rules
- Use vitest (import { describe, it, expect, vi } from 'vitest')
- Follow AAA pattern (Arrange / Act / Assert)
- Name tests: "should [verb] when [condition]"
- Mock external dependencies with vi.mock()
- Test exported functions/classes only
- Cover happy path + at least 1 error case per function
- Do NOT add comments like "// Arrange" - the code should be self-explanatory
- Output ONLY the test file content, no explanation

## Source file: ${sourcePath}
\`\`\`typescript
${sourceCode}
\`\`\`
${context}
## Output format
Return ONLY valid TypeScript test code. No markdown fences, no explanation.`;
};

const detectProvider = (): AIProvider => {
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'claude';
};

const askGroq = (prompt: string): string | null => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  console.log(`    Asking Groq/${GROQ_MODEL}...`);
  const payload = JSON.stringify({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 8192,
  });

  const tmpFile = `groq-req-${Date.now()}.json`;
  writeFileSync(tmpFile, payload);

  try {
    const result = execSync(
      `curl -s -X POST "${GROQ_URL}" -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d @${tmpFile}`,
      { encoding: 'utf-8', timeout: AI_TIMEOUT, maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(result) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`    Groq failed: ${err.message?.slice(0, 200)}`);
    return null;
  } finally {
    try {
      execSync(`rm -f ${tmpFile}`, { encoding: 'utf-8' });
    } catch {
      /* ignore */
    }
  }
};

const askGemini = (prompt: string): string | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  console.log(`    Asking Gemini 2.5 Flash...`);
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  });

  const tmpFile = `gemini-req-${Date.now()}.json`;
  writeFileSync(tmpFile, payload);

  try {
    const result = execSync(
      `curl -s -X POST "${GEMINI_URL}?key=${apiKey}" -H "Content-Type: application/json" -d @${tmpFile}`,
      { encoding: 'utf-8', timeout: AI_TIMEOUT, maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(result) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`    Gemini failed: ${err.message?.slice(0, 200)}`);
    return null;
  } finally {
    try {
      execSync(`rm -f ${tmpFile}`, { encoding: 'utf-8' });
    } catch {
      /* ignore */
    }
  }
};

const askClaude = (prompt: string): string | null => {
  console.log(`    Asking Claude CLI...`);
  try {
    return execSync('claude -p --output-format text', {
      input: prompt,
      encoding: 'utf-8',
      timeout: AI_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`    Claude failed: ${err.message?.slice(0, 200)}`);
    return null;
  }
};

const cleanTestOutput = (raw: string): string | null => {
  let code = raw.trim();

  // Strip markdown fences
  if (code.startsWith('```')) {
    code = code.replace(/^```(?:typescript|ts)?\n?/, '').replace(/\n?```$/, '');
  }

  // Basic validation
  if (!code.includes('describe') && !code.includes('it(') && !code.includes('test(')) {
    return null;
  }

  return code;
};

const generateTest = (
  sourcePath: string,
  sourceCode: string,
  imports: Map<string, string>
): string | null => {
  const prompt = buildTestPrompt(sourcePath, sourceCode, imports);
  console.log(`    Prompt: ${Math.round(prompt.length / 1024)}KB`);

  const provider = detectProvider();
  const providers: Array<{ name: string; fn: (p: string) => string | null }> = [];

  // Order: preferred provider first, then fallbacks
  if (provider === 'groq') {
    providers.push(
      { name: 'groq', fn: askGroq },
      { name: 'gemini', fn: askGemini },
      { name: 'claude', fn: askClaude }
    );
  } else if (provider === 'gemini') {
    providers.push(
      { name: 'gemini', fn: askGemini },
      { name: 'groq', fn: askGroq },
      { name: 'claude', fn: askClaude }
    );
  } else {
    providers.push(
      { name: 'claude', fn: askClaude },
      { name: 'groq', fn: askGroq },
      { name: 'gemini', fn: askGemini }
    );
  }

  for (const { name, fn } of providers) {
    const raw = fn(prompt);
    if (!raw) continue;

    const code = cleanTestOutput(raw);
    if (code) {
      console.log(`    Generated via ${name}`);
      return code;
    }
    console.log(`    ${name}: invalid output, trying next...`);
  }

  console.log(`    All providers failed`);
  return null;
};

// --- PR creation ---

const uploadFile = (
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string
): boolean => {
  const encoded = Buffer.from(content).toString('base64');
  const tmpFile = `ai-test-blob-${Date.now()}.json`;
  writeFileSync(tmpFile, JSON.stringify({ content: encoded, encoding: 'base64' }));

  const blobResult = sh(`gh api repos/${repo}/git/blobs --input ${tmpFile}`);
  try {
    execSync(`rm -f ${tmpFile}`, { encoding: 'utf-8' });
  } catch {
    // ignore cleanup errors on Windows
  }

  let blobSha: string;
  try {
    blobSha = (JSON.parse(blobResult) as { sha: string }).sha;
  } catch {
    return false;
  }

  const refData = ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${branch}`);
  if (!refData) return false;

  const commitData = ghApi<{ tree: { sha: string } }>(
    `repos/${repo}/git/commits/${refData.object.sha}`
  );
  if (!commitData) return false;

  const treeResult = sh(
    `gh api repos/${repo}/git/trees -f base_tree="${commitData.tree.sha}" -f "tree[][path]=${path}" -f "tree[][mode]=100644" -f "tree[][type]=blob" -f "tree[][sha]=${blobSha}"`
  );

  let treeSha: string;
  try {
    treeSha = (JSON.parse(treeResult) as { sha: string }).sha;
  } catch {
    return false;
  }

  const newCommit = sh(
    `gh api repos/${repo}/git/commits -f message="${message}" -f "tree=${treeSha}" -f "parents[]=${refData.object.sha}"`
  );

  let newSha: string;
  try {
    newSha = (JSON.parse(newCommit) as { sha: string }).sha;
  } catch {
    return false;
  }

  const updateResult = sh(
    `gh api repos/${repo}/git/refs/heads/${branch} -X PATCH -f sha="${newSha}"`
  );
  return updateResult.includes(newSha);
};

const createTestPR = (repo: string, tests: GeneratedTest[], baseBranch: string): string | null => {
  const branchName = `devops-factory/ai-tests-${Date.now()}`;

  // Create branch
  const refData = ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${baseBranch}`);
  if (!refData?.object?.sha) return null;

  const branchResult = sh(
    `gh api repos/${repo}/git/refs -f ref="refs/heads/${branchName}" -f sha="${refData.object.sha}"`
  );
  if (!branchResult.includes(branchName) && !branchResult.includes(refData.object.sha)) return null;

  // Upload each test file
  for (const test of tests) {
    console.log(`  Uploading ${test.testPath}...`);
    uploadFile(
      repo,
      branchName,
      test.testPath,
      test.content,
      `test: add AI-generated tests for ${test.sourcePath}`
    );
  }

  // Create PR
  const fileList = tests.map((t) => `- \`${t.testPath}\` (from \`${t.sourcePath}\`)`).join('\n');
  const body = `## AI-Generated Tests

### Files added
${fileList}

### What was generated
Tests written by Claude based on source code analysis.
Each test file covers exported functions with happy path + error cases.

### Review checklist
- [ ] Tests are meaningful (not just trivial assertions)
- [ ] Mocks are correct for the project's architecture
- [ ] No hardcoded values that should be dynamic
- [ ] Tests actually run: \`pnpm test\`

> Generated by DevOps-Factory AI Test Writer (Claude CLI)
> **Human review required before merge**`;

  const prUrl = sh(
    `gh pr create --repo ${repo} --head ${branchName} --base ${baseBranch} --title "test: add AI-generated tests" --body "${body.replace(/"/g, '\\"')}"`
  );

  return prUrl.match(/(https:\/\/[^\s]+)/)?.[1] || null;
};

// --- Main ---

const parseCliArgs = (): { targetRepo?: string } => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) return { targetRepo: args[i + 1] };
  }
  return {};
};

const processRepo = (repo: string, repoName: string): void => {
  console.log(`\nProcessing ${repoName}...`);

  // Get default branch
  const repoInfo = ghApi<{ default_branch: string }>(`repos/${repo}`);
  const branch = repoInfo?.default_branch || 'main';

  // Get file tree
  const tree = getRepoTree(repo, branch);
  if (tree.length === 0) {
    console.log('  Empty tree, skipping');
    return;
  }

  // Find untested files
  const untested = findUntested(tree);
  if (untested.length === 0) {
    console.log('  All source files have tests');
    return;
  }
  console.log(`  ${untested.length} untested file(s) found`);

  // Prioritize: services > utils > components (by path depth and name)
  const prioritized = untested.sort((a, b) => {
    const score = (p: string): number => {
      if (p.includes('/services/') || p.includes('/service')) return 0;
      if (p.includes('/utils/') || p.includes('/helpers/')) return 1;
      if (p.includes('/lib/')) return 2;
      return 3;
    };
    return score(a) - score(b);
  });

  // Take max N files
  const targets = prioritized.slice(0, MAX_FILES_PER_REPO);
  console.log(`  Targeting ${targets.length} file(s) for test generation`);

  // Check quota
  if (!consumeQuota(targets.length)) {
    console.log('  Quota exceeded, skipping');
    return;
  }

  const generated: GeneratedTest[] = [];

  for (const sourcePath of targets) {
    console.log(`\n  [${sourcePath}]`);

    // Fetch source
    const source = fetchFile(repo, sourcePath, branch);
    if (!source) {
      console.log('    Could not fetch file');
      continue;
    }
    console.log(`    Source: ${Math.round(source.length / 1024)}KB`);

    // Fetch imports for context
    const importPaths = findImports(source, tree, sourcePath);
    const imports = new Map<string, string>();
    for (const imp of importPaths) {
      const impContent = fetchFile(repo, imp, branch);
      if (impContent) imports.set(imp, impContent);
    }
    if (imports.size > 0) console.log(`    Context: ${imports.size} imported module(s)`);

    // Generate test
    const testCode = generateTest(sourcePath, source, imports);
    if (!testCode) continue;

    const ext = sourcePath.match(/\.(ts|tsx)$/)?.[0] ?? '.ts';
    const testPath = sourcePath.replace(/\.(ts|tsx)$/, `.test${ext}`);

    generated.push({ testPath, sourcePath, content: testCode });
    console.log(`    Generated ${testPath} (${Math.round(testCode.length / 1024)}KB)`);
  }

  if (generated.length === 0) {
    console.log('\n  No tests generated');
    return;
  }

  // Create PR
  console.log(`\n  Creating PR with ${generated.length} test file(s)...`);
  const prUrl = createTestPR(repo, generated, branch);
  if (prUrl) {
    console.log(`  PR: ${prUrl}`);
  } else {
    console.log('  Failed to create PR');
  }
};

const main = (): void => {
  console.log('DevOps-Factory: AI Test Writer\n');

  const { targetRepo } = parseCliArgs();

  const projects = KNOWN_PROJECTS.filter(
    (p) => p.stack === 'node' || p.stack === 'nextjs' || p.stack === 'fastify'
  );

  if (targetRepo) {
    const project = projects.find((p) => p.repo === targetRepo);
    if (!project) {
      console.error(`Repo ${targetRepo} not found or not a Node.js project`);
      process.exit(1);
    }
    processRepo(project.repo, project.name);
  } else {
    // Process all repos with low test coverage
    for (const project of projects) {
      processRepo(project.repo, project.name);
    }
  }

  console.log('\nAI Test Writer complete.');
};

main();
