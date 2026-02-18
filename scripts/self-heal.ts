/**
 * self-heal.ts
 *
 * Analyzes CI failures using Gemini 2.5 Flash and creates fix PRs.
 * Works entirely via GitHub API (no local clone needed).
 *
 * Run: pnpm self-heal -- --repo owner/name --run-id 123456
 * Trigger: workflow_dispatch from dashboard-build or manual
 */

import { execSync } from 'node:child_process';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_LOG_LINES = 600;

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

/** Run gh api and parse JSON response (no --jq for Windows compat) */
const ghApi = <T>(endpoint: string): T | null => {
  const raw = sh(`gh api ${endpoint}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const fetchFailedLogs = (repo: string, runId: string): string => {
  console.log(`Fetching failed logs for ${repo} run #${runId}...`);
  const logs = sh(`gh run view ${runId} --repo ${repo} --log-failed`);
  if (!logs) {
    console.error('No failed logs found');
    return '';
  }
  const lines = logs.split('\n');
  if (lines.length > MAX_LOG_LINES) {
    return lines.slice(-MAX_LOG_LINES).join('\n');
  }
  return logs;
};

const extractErrorFiles = (logs: string): string[] => {
  const files = new Set<string>();

  // C#/.NET patterns: path\file.cs(line,col)
  const csRegex = /([A-Za-z]?[A-Za-z0-9_./\\-]+\.(?:cs|csx|fs|fsx))\(/g;
  // TypeScript/JS patterns: path/file.ts(line,col) or path/file.ts:line:col
  const tsRegex = /([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx))[\(:]/g;
  // Python: File "path/file.py", line X
  const pyRegex = /File "([^"]+\.py)"/g;
  // Generic error in file pattern
  const genericRegex = /(?:error|Error|ERROR)\s+(?:in|at)\s+([A-Za-z0-9_./\\-]+\.\w+)/g;

  for (const regex of [csRegex, tsRegex, pyRegex, genericRegex]) {
    let match;
    while ((match = regex.exec(logs)) !== null) {
      let filePath = match[1].replace(/\\/g, '/').replace(/^\.\//, '');

      // Remove common CI prefixes
      filePath = filePath.replace(/^D:\/a\/[^/]+\/[^/]+\//, '');
      filePath = filePath.replace(/^\/home\/runner\/work\/[^/]+\/[^/]+\//, '');

      if (
        !filePath.includes('node_modules') &&
        !filePath.includes('/obj/') &&
        !filePath.includes('/bin/')
      ) {
        files.add(filePath);
      }
    }
  }

  return [...files];
};

const getDefaultBranch = (repo: string): string => {
  const data = ghApi<{ default_branch?: string }>(`repos/${repo}`);
  return data?.default_branch || 'main';
};

const fetchFileContents = (repo: string, paths: string[], branch: string): Map<string, string> => {
  const contents = new Map<string, string>();

  for (const path of paths.slice(0, 10)) {
    console.log(`  Fetching ${path}...`);
    const data = ghApi<{ content?: string }>(`repos/${repo}/contents/${path}?ref=${branch}`);
    if (data?.content) {
      try {
        const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
        contents.set(path, decoded);
      } catch {
        console.warn(`  Could not decode ${path}`);
      }
    } else {
      console.warn(`  File not found: ${path}`);
    }
  }

  return contents;
};

interface GeminiFix {
  path: string;
  content: string;
}

interface GeminiResponse {
  fixes: GeminiFix[];
  explanation: string;
}

const askGemini = async (logs: string, files: Map<string, string>): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    return { fixes: [], explanation: 'Missing GEMINI_API_KEY' };
  }

  const filesContext = [...files.entries()]
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const prompt = `You are a CI/CD fix assistant. Analyze the following CI failure logs and source files, then propose minimal fixes.

## CI Error Logs
\`\`\`
${logs.slice(0, 8000)}
\`\`\`

## Source Files
${filesContext.slice(0, 50000)}

## Instructions
- Identify the root cause of the CI failure
- Propose the MINIMAL fix needed (fewest lines changed)
- Return ONLY valid JSON, no markdown wrapping
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

  console.log('Asking Gemini 2.5 Flash for analysis...');

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
    // Try to extract JSON from markdown code block
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

const applyFixes = (
  repo: string,
  branch: string,
  baseBranch: string,
  fixes: GeminiFix[]
): boolean => {
  let success = true;

  for (const fix of fixes) {
    console.log(`  Applying fix to ${fix.path}...`);

    // Get current file SHA (needed for update)
    const fileData = ghApi<{ sha?: string }>(
      `repos/${repo}/contents/${fix.path}?ref=${baseBranch}`
    );
    const fileSha = fileData?.sha;

    const contentBase64 = Buffer.from(fix.content).toString('base64');

    const cmd = fileSha
      ? `gh api repos/${repo}/contents/${fix.path} -X PUT -f message="fix: AI-generated fix for CI failure" -f content="${contentBase64}" -f branch="${branch}" -f sha="${fileSha}"`
      : `gh api repos/${repo}/contents/${fix.path} -X PUT -f message="fix: AI-generated fix for CI failure" -f content="${contentBase64}" -f branch="${branch}"`;

    const result = sh(cmd);
    if (!result || result.includes('error')) {
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
    const url = prUrl.match(/(https:\/\/[^\s]+)/)?.[1] || prUrl;
    console.log(`PR created: ${url}`);
    return url;
  }

  // Label might not exist, try without
  const prUrl2 = sh(
    `gh pr create --repo ${repo} --head ${branch} --base ${baseBranch} --title "${title}" --body "${body.replace(/"/g, '\\"')}"`
  );

  const url = prUrl2.match(/(https:\/\/[^\s]+)/)?.[1] || prUrl2;
  console.log(`PR created: ${url}`);
  return url;
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

const main = async (): Promise<void> => {
  const { repo, runId } = parseArgs();
  console.log(`\nSelf-Healing CI for ${repo} (run #${runId})\n`);

  // 1. Fetch failed logs
  const logs = fetchFailedLogs(repo, runId);
  if (!logs) {
    console.log('No failed logs found - run may not have failed');
    return;
  }

  // 2. Extract error files
  const errorFiles = extractErrorFiles(logs);
  console.log(`Found ${errorFiles.length} file(s) referenced in errors:`, errorFiles);

  // 3. Get default branch
  const defaultBranch = getDefaultBranch(repo);
  console.log(`Default branch: ${defaultBranch}`);

  // 4. Fetch file contents
  const fileContents = fetchFileContents(repo, errorFiles, defaultBranch);
  console.log(`Fetched ${fileContents.size} file(s) content\n`);

  // 5. Ask Gemini for a fix
  const geminiResponse = await askGemini(logs, fileContents);
  console.log(`\nGemini analysis: ${geminiResponse.explanation}`);
  console.log(`Proposed fixes: ${geminiResponse.fixes.length}`);

  // 6. Apply fixes or create issue
  if (geminiResponse.fixes.length === 0) {
    console.log('\nNo fixes proposed - creating issue...');
    createIssue(repo, runId, geminiResponse.explanation);
    return;
  }

  const branchName = `ai-fix/ci-${Date.now()}`;
  console.log(`\nCreating branch: ${branchName}`);

  if (!createBranch(repo, branchName, defaultBranch)) {
    console.error('Failed to create branch');
    createIssue(repo, runId, geminiResponse.explanation);
    return;
  }

  console.log('Applying fixes...');
  const applied = applyFixes(repo, branchName, defaultBranch, geminiResponse.fixes);

  if (!applied) {
    console.error('Some fixes failed to apply');
  }

  // 7. Create PR
  const prUrl = createFixPR(repo, branchName, defaultBranch, runId, geminiResponse.explanation);
  console.log(`\nDone! PR: ${prUrl}`);
};

main().catch((err) => {
  console.error('Self-heal failed:', err);
  process.exit(1);
});
