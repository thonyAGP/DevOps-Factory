/**
 * weekly-veille.ts
 *
 * Automated weekly tech watch for the DevOps ecosystem.
 * Fetches GitHub releases, changelogs, and uses Gemini to synthesize
 * a structured report posted as a GitHub Issue.
 *
 * Run: pnpm veille
 * Trigger: GitHub Actions (Sunday 20h UTC)
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

// --- Types ---

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string;
}

interface WatchSource {
  name: string;
  category: string;
  repo?: string;
  url?: string;
}

interface SourceUpdate {
  source: string;
  category: string;
  type: 'release' | 'changelog' | 'news';
  version?: string;
  date: string;
  summary: string;
  url: string;
  breaking: boolean;
}

interface VeilleReport {
  date: string;
  updates: SourceUpdate[];
  synthesis: string;
  recommendations: string[];
}

// --- Shell helpers ---

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }).trim();
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

// --- Source configuration ---

const GITHUB_SOURCES: WatchSource[] = [
  // AI & Coding Assistants
  { name: 'Claude Code', category: 'Claude & Anthropic', repo: 'anthropics/claude-code' },
  { name: 'Aider', category: 'AI Coding Assistants', repo: 'Aider-AI/aider' },
  {
    name: 'awesome-claude-code',
    category: 'Claude & Anthropic',
    repo: 'hesreallyhim/awesome-claude-code',
  },

  // Agents & Frameworks
  { name: 'Vercel AI SDK', category: 'Agents & Frameworks', repo: 'vercel/ai' },
  { name: 'LangGraph', category: 'Agents & Frameworks', repo: 'langchain-ai/langgraph' },
  { name: 'CrewAI', category: 'Agents & Frameworks', repo: 'crewAIInc/crewAI' },
  {
    name: 'OpenAI Agents SDK',
    category: 'Agents & Frameworks',
    repo: 'openai/openai-agents-python',
  },
  { name: 'Google ADK', category: 'Agents & Frameworks', repo: 'google/adk-python' },

  // MCP & Protocols
  {
    name: 'awesome-mcp-servers',
    category: 'MCP & Protocols',
    repo: 'punkpeye/awesome-mcp-servers',
  },
  { name: 'A2A Protocol', category: 'MCP & Protocols', repo: 'google/A2A' },
  { name: 'MCP Spec', category: 'MCP & Protocols', repo: 'modelcontextprotocol/specification' },

  // Dev Tools (our stack)
  { name: 'TypeScript', category: 'Dev Tools', repo: 'microsoft/TypeScript' },
  { name: 'Node.js', category: 'Dev Tools', repo: 'nodejs/node' },
  { name: 'Next.js', category: 'Dev Tools', repo: 'vercel/next.js' },
  { name: 'Fastify', category: 'Dev Tools', repo: 'fastify/fastify' },
  { name: 'Prisma', category: 'Dev Tools', repo: 'prisma/prisma' },
  { name: 'Vitest', category: 'Dev Tools', repo: 'vitest-dev/vitest' },
  { name: 'Playwright', category: 'Dev Tools', repo: 'microsoft/playwright' },
  { name: 'pnpm', category: 'Dev Tools', repo: 'pnpm/pnpm' },
  { name: 'ESLint', category: 'Dev Tools', repo: 'eslint/eslint' },
  { name: 'Zod', category: 'Dev Tools', repo: 'colinhacks/zod' },

  // DevOps & Security Tools (what we deploy)
  { name: 'Renovate', category: 'DevOps Tools', repo: 'renovatebot/renovate' },
  { name: 'Trivy', category: 'DevOps Tools', repo: 'aquasecurity/trivy' },
  { name: 'Gitleaks', category: 'DevOps Tools', repo: 'gitleaks/gitleaks' },
  { name: 'Semgrep', category: 'DevOps Tools', repo: 'semgrep/semgrep' },
  { name: 'semantic-release', category: 'DevOps Tools', repo: 'semantic-release/semantic-release' },
  { name: 'Stryker', category: 'DevOps Tools', repo: 'stryker-mutator/stryker-js' },
  { name: 'Knip', category: 'DevOps Tools', repo: 'webpro-nl/knip' },
  { name: 'GitHub Actions', category: 'DevOps Tools', repo: 'actions/runner' },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// --- Data fetching ---

const getRecentReleases = (repo: string, sinceDate: string): GitHubRelease[] => {
  const releases = ghApi<GitHubRelease[]>(`repos/${repo}/releases?per_page=5`);
  if (!releases) return [];
  return releases.filter((r) => r.published_at >= sinceDate);
};

const fetchUpdates = (): SourceUpdate[] => {
  const updates: SourceUpdate[] = [];
  const sinceDate = new Date(Date.now() - WEEK_MS).toISOString().split('T')[0];

  console.log(`Fetching updates since ${sinceDate}...\n`);

  for (const source of GITHUB_SOURCES) {
    if (!source.repo) continue;

    process.stdout.write(`  ${source.name}... `);

    const releases = getRecentReleases(source.repo, sinceDate);

    if (releases.length > 0) {
      for (const release of releases) {
        const bodyPreview = (release.body || '').slice(0, 500);
        const isBreaking =
          bodyPreview.toLowerCase().includes('breaking') ||
          bodyPreview.toLowerCase().includes('major');

        updates.push({
          source: source.name,
          category: source.category,
          type: 'release',
          version: release.tag_name,
          date: release.published_at.split('T')[0],
          summary: release.name || release.tag_name,
          url: release.html_url,
          breaking: isBreaking,
        });
      }
      console.log(`${releases.length} release(s)`);
    } else {
      console.log('no new releases');
    }
  }

  return updates;
};

// --- Gemini synthesis ---

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const synthesizeWithGemini = (updates: SourceUpdate[]): string => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('  No GEMINI_API_KEY - skipping AI synthesis');
    return '';
  }

  if (updates.length === 0) {
    return 'No significant updates this week.';
  }

  const updatesList = updates
    .map(
      (u) =>
        `- [${u.category}] ${u.source} ${u.version || ''}: ${u.summary} (${u.breaking ? 'BREAKING' : 'non-breaking'})`
    )
    .join('\n');

  const prompt = `Tu es un expert DevOps et developpeur senior TypeScript/Node.js/React.
Analyse ces mises a jour detectees cette semaine et produis une synthese en francais.

## Mises a jour detectees

${updatesList}

## Instructions

1. **Resume** (3-5 phrases) : Quelles sont les tendances de la semaine ?
2. **Impact pour notre stack** (TypeScript, Next.js, Fastify, Prisma, Vitest, Playwright, GitHub Actions) :
   - Quelles mises a jour sont directement pertinentes ?
   - Y a-t-il des breaking changes a anticiper ?
3. **Recommandations** (liste numerotee, max 5) :
   - Actions concretes a prendre (mettre a jour, tester, surveiller)
   - Prioriser par impact

Format ta reponse en Markdown avec des sections claires.`;

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
    return text || '';
  } catch (e) {
    console.error('Gemini synthesis error:', e instanceof Error ? e.message : String(e));
    return '';
  }
};

// --- Report generation ---

const generateMarkdownReport = (report: VeilleReport): string => {
  const lines: string[] = [
    `## Veille Technologique - Semaine du ${report.date}`,
    '',
    `> ${report.updates.length} mises a jour detectees sur ${GITHUB_SOURCES.length} sources`,
    '',
  ];

  // Updates by category
  const categories = [...new Set(report.updates.map((u) => u.category))];

  for (const cat of categories) {
    const catUpdates = report.updates.filter((u) => u.category === cat);
    lines.push(`### ${cat}`);
    lines.push('');
    lines.push('| Projet | Version | Date | Breaking | Lien |');
    lines.push('|--------|---------|------|----------|------|');
    for (const u of catUpdates) {
      const breakBadge = u.breaking ? '**OUI**' : '-';
      lines.push(
        `| ${u.source} | ${u.version || '-'} | ${u.date} | ${breakBadge} | [Release](${u.url}) |`
      );
    }
    lines.push('');
  }

  if (report.updates.length === 0) {
    lines.push('### Aucune nouvelle release cette semaine');
    lines.push('');
    lines.push('Toutes les sources surveillees sont stables.');
    lines.push('');
  }

  // AI Synthesis
  if (report.synthesis) {
    lines.push('---');
    lines.push('');
    lines.push('### Synthese IA');
    lines.push('');
    lines.push(report.synthesis);
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(`*Auto-generated by DevOps-Factory Weekly Veille (${new Date().toISOString()})*`);

  return lines.join('\n');
};

// --- History management ---

const HISTORY_PATH = 'data/veille-history.json';

const saveReport = (report: VeilleReport): void => {
  let history: VeilleReport[] = [];
  if (existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')) as VeilleReport[];
    } catch {
      history = [];
    }
  }

  // Keep last 12 weeks
  history.unshift(report);
  if (history.length > 12) history = history.slice(0, 12);

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
};

// --- Post to GitHub ---

const postVeilleIssue = (factoryRepo: string, markdown: string, date: string): void => {
  const LABEL = 'veille';

  // Create label if needed
  sh(
    `gh label create "${LABEL}" --repo ${factoryRepo} --color "7057ff" --description "Weekly tech watch report" --force`
  );

  // Close previous open veille issues
  const existing = sh(
    `gh issue list --repo ${factoryRepo} --label "${LABEL}" --state open --json number`
  );
  try {
    const issues = JSON.parse(existing || '[]') as { number: number }[];
    for (const issue of issues) {
      sh(
        `gh issue close ${issue.number} --repo ${factoryRepo} --comment "Superseded by new weekly veille"`
      );
    }
  } catch {
    // ignore
  }

  const tmpFile = '/tmp/veille-body.md';
  writeFileSync(tmpFile, markdown);
  sh(
    `gh issue create --repo ${factoryRepo} --title "Veille Technologique - ${date}" --body-file "${tmpFile}" --label "${LABEL}"`
  );
};

// --- Main ---

const main = (): void => {
  const factoryRepo = process.env.GITHUB_REPOSITORY ?? 'thonyAGP/DevOps-Factory';
  const today = new Date().toISOString().split('T')[0];

  console.log(`\nWeekly Veille - ${today}`);
  console.log(`Monitoring ${GITHUB_SOURCES.length} sources\n`);

  // 1. Fetch updates from GitHub repos
  console.log('Phase 1: Fetching GitHub releases...');
  const updates = fetchUpdates();

  console.log(`\nFound ${updates.length} updates this week`);

  // 2. Synthesize with Gemini
  console.log('\nPhase 2: AI Synthesis...');
  const synthesis = synthesizeWithGemini(updates);

  // 3. Build report
  const report: VeilleReport = {
    date: today,
    updates,
    synthesis,
    recommendations: [],
  };

  // 4. Generate markdown
  const markdown = generateMarkdownReport(report);

  // 5. Save locally
  writeFileSync('data/veille-report.md', markdown);
  saveReport(report);
  console.log('\nReport saved to data/veille-report.md');

  // 6. Post as GitHub issue (in CI)
  if (process.env.GITHUB_ACTIONS) {
    console.log('Posting veille issue...');
    postVeilleIssue(factoryRepo, markdown, today);
  }

  // 7. Summary
  const breaking = updates.filter((u) => u.breaking).length;
  console.log('\n--- Summary ---');
  console.log(`Sources monitored: ${GITHUB_SOURCES.length}`);
  console.log(`Updates found: ${updates.length}`);
  if (breaking > 0) console.log(`Breaking changes: ${breaking}`);
  console.log('');
};

main();
