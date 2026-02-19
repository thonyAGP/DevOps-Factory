/**
 * claude-review.ts
 *
 * Performs AI code review on PRs using Claude via the claude CLI (Max plan tokens).
 * Uses same patterns as other DevOps-Factory scripts.
 *
 * Run: pnpm claude-review -- --repo owner/name --pr 123
 * Trigger: GitHub Actions (on pull_request event)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { CLAUDE_REVIEW_CONFIG } from '../factory.config.js';

// --- Types ---

interface ParsedArgs {
  repo: string;
  pr: string;
}

interface PRInfo {
  title: string;
  body: string;
  filesChanged: number;
}

interface QuotaData {
  date: string;
  count: number;
  maxPerDay: number;
}

// --- Shell helpers ---

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  let repo = '';
  let pr = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
    if (args[i] === '--pr' && args[i + 1]) pr = args[i + 1];
  }

  if (!repo || !pr) {
    console.error('Usage: tsx scripts/claude-review.ts --repo owner/name --pr 123');
    process.exit(1);
  }

  return { repo, pr };
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
  const raw = sh(`gh api "${endpoint}"`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// --- Quota management ---

const quotaFilePath = 'data/claude-review-quota.json';

const ensureQuotaFile = (): void => {
  if (!existsSync(quotaFilePath)) {
    const dir = dirname(quotaFilePath);
    if (!existsSync(dir)) {
      execSync(`mkdir -p "${dir}"`, { encoding: 'utf-8' });
    }
    const initial: QuotaData = {
      date: new Date().toISOString().split('T')[0],
      count: 0,
      maxPerDay: CLAUDE_REVIEW_CONFIG.maxReviewsPerDay,
    };
    writeFileSync(quotaFilePath, JSON.stringify(initial, null, 2));
  }
};

const getQuota = (): QuotaData => {
  ensureQuotaFile();
  const content = readFileSync(quotaFilePath, 'utf-8');
  return JSON.parse(content) as QuotaData;
};

const checkQuota = (): boolean => {
  const quota = getQuota();
  const today = new Date().toISOString().split('T')[0];

  if (quota.date !== today) {
    quota.date = today;
    quota.count = 0;
  }

  return quota.count < quota.maxPerDay;
};

const incrementQuota = (): void => {
  const quota = getQuota();
  const today = new Date().toISOString().split('T')[0];

  if (quota.date !== today) {
    quota.date = today;
    quota.count = 1;
  } else {
    quota.count += 1;
  }

  quota.maxPerDay = CLAUDE_REVIEW_CONFIG.maxReviewsPerDay;
  writeFileSync(quotaFilePath, JSON.stringify(quota, null, 2));
};

// --- PR data fetching ---

const getPRDiff = (repo: string, pr: string): string => {
  return sh(`gh pr diff ${pr} --repo ${repo}`);
};

const getPRInfo = (repo: string, pr: string): PRInfo => {
  const data = ghApi<{
    title: string;
    body: string;
    changed_files: number;
  }>(`repos/${repo}/pulls/${pr}`);

  return {
    title: data?.title || 'Unknown PR',
    body: data?.body || '',
    filesChanged: data?.changed_files || 0,
  };
};

// --- Claude review analysis ---

const buildReviewPrompt = (diff: string, prInfo: PRInfo): string => {
  return `You are a senior code reviewer. Analyze this PR diff and provide a concise review focusing on:
1. Bugs or logic errors
2. Security vulnerabilities (OWASP Top 10)
3. Performance issues
4. TypeScript anti-patterns (any types, missing error handling)
5. Missing tests for new code

Format your review as:
## AI Code Review

### Summary
[1-2 sentence summary]

### Issues Found
[List issues with severity: CRITICAL/WARNING/INFO]

### Suggestions
[Improvement suggestions]

If the code looks good, say so briefly. Don't nitpick formatting (Prettier handles that).

---

**PR**: ${prInfo.title}
**Files changed**: ${prInfo.filesChanged}

## Diff
\`\`\`diff
${diff.slice(0, 40000)}
\`\`\``;
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const runClaudeReview = (diff: string, prInfo: PRInfo): string => {
  const prompt = buildReviewPrompt(diff, prInfo);

  // Try Claude CLI first (works locally with Max plan tokens)
  try {
    const result = execSync('claude -p --output-format text', {
      input: prompt,
      encoding: 'utf-8',
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.trim() + '\n\n---\n*Reviewed by Claude (Max plan)*';
  } catch {
    console.log('  Claude CLI unavailable, trying Gemini fallback...');
  }

  // Fallback: Gemini API (works in CI with API key)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return `## AI Code Review\n\n> Review unavailable: no Claude CLI or GEMINI_API_KEY. Manual review recommended.\n\nFiles changed: ${prInfo.filesChanged}`;
  }

  try {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
    });
    const result = execSync(
      `curl -s -X POST "${GEMINI_URL}?key=${apiKey}" -H "Content-Type: application/json" -d @-`,
      { input: body, encoding: 'utf-8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
    );
    const parsed = JSON.parse(result);
    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text + '\n\n---\n*Reviewed by Gemini 2.5 Flash*';
  } catch (e) {
    console.error('Gemini review error:', e instanceof Error ? e.message : String(e));
  }

  return `## AI Code Review\n\n> Review failed. Manual review recommended.\n\nFiles changed: ${prInfo.filesChanged}`;
};

// --- Posting review ---

const postReviewComment = (repo: string, pr: string, review: string): void => {
  const tmpFile = '/tmp/claude-review-body.md';
  writeFileSync(tmpFile, review);
  sh(`gh pr comment ${pr} --repo ${repo} --body-file ${tmpFile}`);
};

// --- Main ---

const main = async (): Promise<void> => {
  const { repo, pr } = parseArgs();
  console.log(`\n🔍 Claude PR Review for ${repo} #${pr}\n`);

  // Check if repo is enabled
  if (!CLAUDE_REVIEW_CONFIG.enabledRepos.includes(repo)) {
    console.log(`⊘ Repo ${repo} not in enabled list. Skipping review.`);
    return;
  }

  // Check quota
  if (!checkQuota()) {
    const quota = getQuota();
    const quotaMsg = `⚠️  Daily review quota exceeded (${quota.count}/${quota.maxPerDay}). Review skipped for today.`;
    console.log(quotaMsg);
    postReviewComment(repo, pr, quotaMsg);
    return;
  }

  // Get PR info
  console.log('Fetching PR info...');
  const prInfo = getPRInfo(repo, pr);
  console.log(`  Title: ${prInfo.title}`);
  console.log(`  Files: ${prInfo.filesChanged}`);

  // Get diff
  console.log('Fetching PR diff...');
  const diff = getPRDiff(repo, pr);
  if (!diff) {
    console.log('  No diff found (possibly merged or deleted PR)');
    return;
  }
  console.log(`  Diff size: ${Math.round(diff.length / 1024)}KB`);

  // Run Claude review
  console.log('Running Claude review...');
  const review = runClaudeReview(diff, prInfo);

  // Post comment
  console.log('Posting review comment...');
  postReviewComment(repo, pr, review);

  // Update quota
  incrementQuota();

  const quota = getQuota();
  console.log(`\n✅ Review posted (${quota.count}/${quota.maxPerDay} today)\n`);
};

main().catch((err) => {
  console.error('Claude review failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
