/**
 * scan-and-configure.ts
 *
 * Scans all GitHub repos for the authenticated user,
 * detects project type, and creates PRs to add missing
 * DevOps-Factory workflows.
 *
 * Run: pnpm scan
 * Cron: every 6h via GitHub Actions
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

interface Repo {
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
  language: string | null;
}

interface RepoAnalysis {
  repo: Repo;
  stack: "nextjs" | "node" | "dotnet" | "unknown";
  packageManager: "pnpm" | "npm" | "yarn" | "none";
  hasClaudeReview: boolean;
  hasSelfHealing: boolean;
  hasQodoMerge: boolean;
  hasCI: boolean;
}

const IGNORED_REPOS = [
  "DevOps-Factory",
  "Parametrage_Claude",
  "Migration_Pc1_vers_Pc2",
  ".github",
];

const TEMPLATES_DIR = "templates";

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
};

const ghJson = <T>(cmd: string): T => {
  const result = gh(cmd);
  return JSON.parse(result || "[]") as T;
};

const listRepos = (): Repo[] => {
  const repos = ghJson<Repo[]>(
    'api user/repos --paginate --jq "[.[] | {name, full_name, default_branch, archived, fork, private: .private, language}]"'
  );
  return repos.filter(
    (r) => !r.archived && !r.fork && !IGNORED_REPOS.includes(r.name)
  );
};

const fileExistsInRepo = (repo: string, path: string): boolean => {
  const result = gh(
    `api repos/${repo}/contents/${path} --jq '.name' 2>/dev/null`
  );
  return result.length > 0;
};

const analyzeRepo = (repo: Repo): RepoAnalysis => {
  const hasPackageJson = fileExistsInRepo(repo.full_name, "package.json");
  const hasCsproj =
    repo.language === "C#" ||
    fileExistsInRepo(repo.full_name, "*.csproj");

  let stack: RepoAnalysis["stack"] = "unknown";
  let packageManager: RepoAnalysis["packageManager"] = "none";

  if (hasPackageJson) {
    const hasNextConfig =
      fileExistsInRepo(repo.full_name, "next.config.js") ||
      fileExistsInRepo(repo.full_name, "next.config.mjs") ||
      fileExistsInRepo(repo.full_name, "next.config.ts");

    stack = hasNextConfig ? "nextjs" : "node";

    if (fileExistsInRepo(repo.full_name, "pnpm-lock.yaml")) {
      packageManager = "pnpm";
    } else if (fileExistsInRepo(repo.full_name, "yarn.lock")) {
      packageManager = "yarn";
    } else {
      packageManager = "npm";
    }
  } else if (hasCsproj) {
    stack = "dotnet";
  }

  const hasClaudeReview = fileExistsInRepo(
    repo.full_name,
    ".github/workflows/claude-review.yml"
  );
  const hasSelfHealing = fileExistsInRepo(
    repo.full_name,
    ".github/workflows/self-healing.yml"
  );
  const hasQodoMerge = fileExistsInRepo(
    repo.full_name,
    ".github/workflows/qodo-merge.yml"
  );

  // Check for any CI workflow
  const workflowsDir = gh(
    `api repos/${repo.full_name}/contents/.github/workflows --jq '.[].name' 2>/dev/null`
  );
  const hasCI =
    workflowsDir.includes("ci.yml") ||
    workflowsDir.includes("CI") ||
    workflowsDir.includes("build") ||
    workflowsDir.includes("test");

  return {
    repo,
    stack,
    packageManager,
    hasClaudeReview,
    hasSelfHealing,
    hasQodoMerge,
    hasCI,
  };
};

const createConfigPR = (analysis: RepoAnalysis): void => {
  const { repo } = analysis;
  const branchName = `devops-factory/add-workflows`;
  const filesToAdd: { path: string; template: string }[] = [];

  if (!analysis.hasClaudeReview && analysis.stack !== "unknown") {
    filesToAdd.push({
      path: ".github/workflows/claude-review.yml",
      template: `${TEMPLATES_DIR}/claude-review.yml`,
    });
  }

  if (!analysis.hasSelfHealing && analysis.stack !== "unknown") {
    filesToAdd.push({
      path: ".github/workflows/self-healing.yml",
      template: `${TEMPLATES_DIR}/self-healing.yml`,
    });
  }

  if (!analysis.hasQodoMerge && analysis.stack !== "unknown") {
    filesToAdd.push({
      path: ".github/workflows/qodo-merge.yml",
      template: `${TEMPLATES_DIR}/qodo-merge.yml`,
    });
  }

  if (filesToAdd.length === 0) {
    console.log(`  [SKIP] ${repo.name}: all workflows present`);
    return;
  }

  // Check if PR already exists
  const existingPR = gh(
    `pr list --repo ${repo.full_name} --head ${branchName} --json number --jq '.[0].number'`
  );
  if (existingPR) {
    console.log(
      `  [SKIP] ${repo.name}: PR #${existingPR} already exists`
    );
    return;
  }

  console.log(
    `  [CREATE] ${repo.name}: adding ${filesToAdd.length} workflow(s)`
  );

  // Create branch and add files via GitHub API (no local clone needed)
  const defaultBranch = repo.default_branch;
  const baseSha = gh(
    `api repos/${repo.full_name}/git/ref/heads/${defaultBranch} --jq '.object.sha'`
  );

  if (!baseSha) {
    console.log(`  [ERROR] ${repo.name}: cannot get base SHA`);
    return;
  }

  // Create branch
  gh(
    `api repos/${repo.full_name}/git/refs --method POST -f ref="refs/heads/${branchName}" -f sha="${baseSha}" 2>/dev/null`
  );

  // Add each file
  for (const file of filesToAdd) {
    const content = execSync(`base64 -w 0 ${file.template}`, {
      encoding: "utf-8",
    }).trim();

    gh(
      `api repos/${repo.full_name}/contents/${file.path} --method PUT -f message="chore: add ${file.path} from DevOps-Factory" -f content="${content}" -f branch="${branchName}"`
    );
  }

  // Create PR
  const fileList = filesToAdd.map((f) => `- \`${f.path}\``).join("\n");
  gh(
    `pr create --repo ${repo.full_name} --head ${branchName} --base ${defaultBranch} --title "chore: add DevOps-Factory AI workflows" --body "## DevOps-Factory Auto-Configuration

### Added workflows
${fileList}

### What this enables
- **Claude Code Review**: AI review on every PR (Haiku for speed, Sonnet for complex changes)
- **Self-Healing CI**: Automatic fix PRs when CI fails on main
- **Qodo Merge**: Complementary AI review via Gemini

### Required secrets
Make sure these secrets are configured in your repo settings:
- \\\`ANTHROPIC_API_KEY\\\`: For Claude Code reviews
- \\\`OPENAI_KEY\\\`: For Qodo Merge (or configure Gemini)

> Auto-generated by [DevOps-Factory](https://github.com/thonyAGP/DevOps-Factory)"`
  );
};

const generateReport = (analyses: RepoAnalysis[]): string => {
  const timestamp = new Date().toISOString();
  const active = analyses.filter((a) => a.stack !== "unknown");
  const configured = active.filter(
    (a) => a.hasClaudeReview && a.hasSelfHealing
  );

  let report = `# DevOps-Factory Scan Report\n\n`;
  report += `**Date**: ${timestamp}\n`;
  report += `**Total repos**: ${analyses.length}\n`;
  report += `**Active projects**: ${active.length}\n`;
  report += `**Fully configured**: ${configured.length}/${active.length}\n\n`;

  report += `| Repo | Stack | CI | Claude | Self-Heal | Qodo |\n`;
  report += `|------|-------|----|--------|-----------|------|\n`;

  for (const a of analyses.sort((x, y) =>
    x.repo.name.localeCompare(y.repo.name)
  )) {
    const ci = a.hasCI ? "Y" : "-";
    const claude = a.hasClaudeReview ? "Y" : "-";
    const heal = a.hasSelfHealing ? "Y" : "-";
    const qodo = a.hasQodoMerge ? "Y" : "-";
    report += `| ${a.repo.name} | ${a.stack} | ${ci} | ${claude} | ${heal} | ${qodo} |\n`;
  }

  return report;
};

// Main execution
const main = () => {
  console.log("DevOps-Factory: Scanning repos...\n");

  const repos = listRepos();
  console.log(`Found ${repos.length} repos (excluding ignored)\n`);

  const analyses: RepoAnalysis[] = [];

  for (const repo of repos) {
    console.log(`Analyzing: ${repo.name} (${repo.language || "unknown"})...`);
    const analysis = analyzeRepo(repo);
    analyses.push(analysis);

    if (analysis.stack !== "unknown") {
      createConfigPR(analysis);
    } else {
      console.log(`  [SKIP] ${repo.name}: no detectable project stack`);
    }
  }

  const report = generateReport(analyses);
  console.log("\n" + report);

  // Write report to file for dashboard consumption
  writeFileSync("dashboard/scan-report.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    analyses: analyses.map((a) => ({
      name: a.repo.name,
      fullName: a.repo.full_name,
      stack: a.stack,
      hasCI: a.hasCI,
      hasClaudeReview: a.hasClaudeReview,
      hasSelfHealing: a.hasSelfHealing,
      hasQodoMerge: a.hasQodoMerge,
      defaultBranch: a.repo.default_branch,
    })),
  }, null, 2));
};

main();
