/**
 * recommendation-engine.ts
 *
 * Smart recommendation engine for template deployment.
 * Analyzes repo health, stack, existing workflows, and CI failures
 * to prioritize template deployments.
 *
 * Generates recommendations.json and recommendations.md for the dashboard.
 *
 * Run: pnpm recommendations
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { logActivity } from './activity-logger.js';

interface RepoAnalysis {
  name: string;
  fullName: string;
  stack: 'nextjs' | 'node' | 'dotnet' | 'unknown';
  hasCI: boolean;
  hasClaudeReview: boolean;
  hasSelfHealing: boolean;
  hasQodoMerge: boolean;
  hasGitleaks: boolean;
  hasRenovate: boolean;
  hasHusky: boolean;
  hasSemgrep: boolean;
  hasLicenseCheck: boolean;
  hasNodeVersionSync: boolean;
  hasEnvSyncCheck: boolean;
  hasOpenSpecDrift: boolean;
  hasOpenSpec: boolean;
  hasPrisma: boolean;
  hasBranchCleanup: boolean;
  hasStaleBot: boolean;
  hasPrDescriptionAI: boolean;
  hasAccessibilityCheck: boolean;
  hasDeadCodeDetection: boolean;
  hasSbomGeneration: boolean;
  hasCronMonitor: boolean;
  hasAutoLabel: boolean;
  hasCodeRabbit: boolean;
  hasMutationTesting: boolean;
  hasPerformanceBudget: boolean;
  hasTestImpactAnalysis: boolean;
  hasDevContainer: boolean;
  hasTypeCoverage: boolean;
  hasDependencySizeCheck: boolean;
  hasSupplyChainSecurity: boolean;
  hasContainerScan: boolean;
  hasSecurityHeaders: boolean;
  hasPrRiskAssessment: boolean;
  hasPrSizeLimiter: boolean;
  hasReleaseDrafter: boolean;
  hasReadmeFreshness: boolean;
  hasConfigDrift: boolean;
  hasCoverageTracking: boolean;
  hasSemanticRelease: boolean;
  hasLighthouse: boolean;
  hasAutoChangelog: boolean;
  hasTypedoc: boolean;
}

interface QualityScore {
  name: string;
  repo: string;
  score: number;
  breakdown: Record<string, number>;
}

interface CostReport {
  repo: string;
  fullName: string;
  totalMinutes: number;
  totalRuns: number;
  workflows: Array<{
    name: string;
    runs: number;
    failedRuns: number;
    wastedMinutes: number;
  }>;
}

interface Recommendation {
  template: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  effort: 'minimal' | 'moderate' | 'significant';
  impact: string;
  conflictsWith?: string[];
}

interface RepoRecommendations {
  repo: string;
  fullName: string;
  healthScore: number;
  stack: string;
  ciFailureRate: number;
  recommendations: Recommendation[];
}

interface RecommendationReport {
  timestamp: string;
  repos: RepoRecommendations[];
  summary: {
    totalRecommendations: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    topTemplates: Array<{ template: string; count: number }>;
    topRepo: string;
    avgHealthScore: number;
  };
}

// Template scoring rules: which stacks need which templates
const TEMPLATE_RULES: Record<
  string,
  {
    stacks: ('nextjs' | 'node' | 'dotnet' | 'unknown')[];
    conditions: (analysis: RepoAnalysis, score: QualityScore, cost: CostReport | null) => boolean;
    priority: 'critical' | 'high' | 'medium' | 'low';
    effort: 'minimal' | 'moderate' | 'significant';
    impact: string;
  }
> = {
  'ci-standard.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasCI,
    priority: 'critical',
    effort: 'moderate',
    impact: 'Enables automated testing and deployment',
  },
  'gitleaks.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasGitleaks,
    priority: 'high',
    effort: 'minimal',
    impact: 'Prevents accidental secret leaks in commits',
  },
  'auto-label.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasAutoLabel,
    priority: 'medium',
    effort: 'minimal',
    impact: 'Automatically labels issues and PRs for better organization',
  },
  'qodo-merge.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasQodoMerge && analysis.hasCI,
    priority: 'high',
    effort: 'minimal',
    impact: 'Free code review from CodeRabbit/Qodo without API keys',
  },
  'lighthouse.yml': {
    stacks: ['nextjs'],
    conditions: (_analysis, score) => score.score < 70,
    priority: 'high',
    effort: 'moderate',
    impact: 'Tracks performance, accessibility, and SEO metrics',
  },
  'accessibility-check.yml': {
    stacks: ['nextjs'],
    conditions: (analysis) => !analysis.hasAccessibilityCheck,
    priority: 'medium',
    effort: 'minimal',
    impact: 'Ensures WCAG compliance and accessibility standards',
  },
  'coverage-tracking.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis, score) => !analysis.hasCoverageTracking && score.score < 60,
    priority: 'high',
    effort: 'moderate',
    impact: 'Tracks test coverage over time and prevents regressions',
  },
  'semantic-release.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis, score) =>
      !analysis.hasSemanticRelease && analysis.hasCI && score.score > 50,
    priority: 'medium',
    effort: 'moderate',
    impact: 'Automated versioning and release notes from git commits',
  },
  'stale-bot.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: () => true,
    priority: 'low',
    effort: 'minimal',
    impact: 'Automatically closes stale issues and PRs',
  },
  'renovate.json': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasRenovate,
    priority: 'high',
    effort: 'minimal',
    impact: 'Automated dependency updates with intelligent grouping',
  },
  'prisma-migration-check.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis) => analysis.hasPrisma && !analysis.hasCI,
    priority: 'high',
    effort: 'moderate',
    impact: 'Validates Prisma migrations and schema changes',
  },
  'container-scan.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: () => true,
    priority: 'medium',
    effort: 'moderate',
    impact: 'Scans container images for vulnerabilities with Trivy',
  },
  'dead-code-detection.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis) => !analysis.hasDeadCodeDetection,
    priority: 'medium',
    effort: 'minimal',
    impact: 'Detects and reports unused code with Knip',
  },
  'semgrep.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasSemgrep,
    priority: 'high',
    effort: 'minimal',
    impact: 'Static analysis for bugs, security issues, and anti-patterns',
  },
  'release-drafter.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasReleaseDrafter && analysis.hasCI,
    priority: 'low',
    effort: 'minimal',
    impact: 'Auto-drafts release notes from PRs and commits',
  },
  'pr-size-limit.yml': {
    stacks: ['nextjs', 'node', 'dotnet'],
    conditions: (analysis) => !analysis.hasPrSizeLimiter,
    priority: 'medium',
    effort: 'minimal',
    impact: 'Enforces PR size limits for code review quality',
  },
  'supply-chain-security.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis) => !analysis.hasSupplyChainSecurity,
    priority: 'medium',
    effort: 'minimal',
    impact: 'Secures npm dependencies with SBOM and license checks',
  },
  'mutation-testing.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis) => !analysis.hasMutationTesting && analysis.hasCI,
    priority: 'low',
    effort: 'significant',
    impact: 'Validates test quality by introducing code mutations',
  },
  'type-coverage.yml': {
    stacks: ['nextjs', 'node'],
    conditions: (analysis) => !analysis.hasTypeCoverage && !analysis.hasDeadCodeDetection,
    priority: 'medium',
    effort: 'minimal',
    impact: 'Ensures TypeScript coverage and type safety',
  },
};

const loadJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    console.error(`Failed to load ${path}:`, error);
    return {};
  }
};

const analyzeRepo = (
  analysis: RepoAnalysis,
  score: QualityScore | undefined,
  cost: CostReport | undefined
): RepoRecommendations => {
  const healthScore = score?.score ?? 0;
  const failureRate = cost
    ? cost.workflows.reduce((sum, w) => sum + (w.failedRuns / w.runs || 0), 0) /
      (cost.workflows.length || 1)
    : 0;

  const recommendations: Recommendation[] = [];

  // Score each template
  for (const [template, rule] of Object.entries(TEMPLATE_RULES)) {
    // Check if stack matches
    if (!rule.stacks.includes(analysis.stack) && !rule.stacks.includes('unknown')) {
      continue;
    }

    // Check conditions
    if (
      !rule.conditions(
        analysis,
        score ?? { score: 0, name: '', repo: '', breakdown: {} },
        cost ?? null
      )
    ) {
      continue;
    }

    // Determine reason
    let reason = '';
    if (template === 'ci-standard.yml') {
      reason = 'No CI workflow detected';
    } else if (template === 'gitleaks.yml') {
      reason = 'No secret scanning detected';
    } else if (template === 'auto-label.yml') {
      reason = 'Would improve issue/PR organization';
    } else if (template === 'qodo-merge.yml') {
      reason = 'Free code reviews without API key requirement';
    } else if (template === 'lighthouse.yml') {
      reason = `Low health score (${healthScore}) - needs performance tracking`;
    } else if (template === 'accessibility-check.yml') {
      reason = 'No accessibility scanning detected';
    } else if (template === 'coverage-tracking.yml') {
      reason = `Low health score (${healthScore}) - needs test coverage tracking`;
    } else if (template === 'semantic-release.yml') {
      reason = 'Automate versioning from commits';
    } else if (template === 'stale-bot.yml') {
      reason = 'Auto-close stale issues and PRs';
    } else if (template === 'renovate.json') {
      reason = 'No dependency update automation detected';
    } else if (template === 'prisma-migration-check.yml') {
      reason = 'Prisma project without migration validation';
    } else if (template === 'container-scan.yml') {
      reason = 'Enhance container security scanning';
    } else if (template === 'dead-code-detection.yml') {
      reason = 'Detect and remove unused code';
    } else if (template === 'semgrep.yml') {
      reason = 'No SAST (static analysis) detected';
    } else if (template === 'release-drafter.yml') {
      reason = 'Auto-generate release notes';
    } else if (template === 'pr-size-limit.yml') {
      reason = 'Enforce maintainable PR sizes';
    } else if (template === 'supply-chain-security.yml') {
      reason = 'Secure npm dependency chain';
    } else if (template === 'mutation-testing.yml') {
      reason = 'Validate test quality';
    } else if (template === 'type-coverage.yml') {
      reason = 'Improve TypeScript coverage';
    }

    // Adjust priority based on health score
    let adjustedPriority = rule.priority;
    if (healthScore < 40 && rule.priority === 'medium') {
      adjustedPriority = 'high';
    }
    if (healthScore < 30 && rule.priority === 'low') {
      adjustedPriority = 'medium';
    }

    // Adjust priority based on failure rate
    if (failureRate > 0.3 && template.includes('coverage')) {
      adjustedPriority = 'high' as const;
    }

    recommendations.push({
      template,
      priority: adjustedPriority,
      reason,
      effort: rule.effort,
      impact: rule.impact,
    });
  }

  // Sort by priority (critical > high > medium > low)
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    repo: analysis.name,
    fullName: analysis.fullName,
    healthScore,
    stack: analysis.stack,
    ciFailureRate: Math.round(failureRate * 100),
    recommendations,
  };
};

const generateMarkdown = (report: RecommendationReport): string => {
  let md = `# Template Recommendations Report\n\n`;
  md += `Generated: ${new Date(report.timestamp).toLocaleString()}\n\n`;

  md += `## Executive Summary\n\n`;
  md += `- **Total Recommendations**: ${report.summary.totalRecommendations}\n`;
  md += `- **Critical**: ${report.summary.criticalCount} | **High**: ${report.summary.highCount} | **Medium**: ${report.summary.mediumCount} | **Low**: ${report.summary.lowCount}\n`;
  md += `- **Average Health Score**: ${report.summary.avgHealthScore.toFixed(1)}/100\n`;
  md += `- **Top Template**: ${report.summary.topTemplates[0]?.template || 'N/A'} (${report.summary.topTemplates[0]?.count || 0} repos)\n`;
  md += `- **Most Improved Repo**: ${report.summary.topRepo}\n\n`;

  md += `## Top Recommended Templates\n\n`;
  for (const t of report.summary.topTemplates.slice(0, 5)) {
    md += `- **${t.template}**: ${t.count} repos\n`;
  }

  md += `\n## Recommendations by Repository\n\n`;

  for (const repo of report.repos) {
    if (repo.recommendations.length === 0) continue;

    md += `### ${repo.repo}\n\n`;
    md += `- **Health Score**: ${repo.healthScore}/100\n`;
    md += `- **Stack**: ${repo.stack}\n`;
    if (repo.ciFailureRate > 0) {
      md += `- **CI Failure Rate**: ${repo.ciFailureRate}%\n`;
    }
    md += `\n`;

    const byCriticality = {
      critical: repo.recommendations.filter((r) => r.priority === 'critical'),
      high: repo.recommendations.filter((r) => r.priority === 'high'),
      medium: repo.recommendations.filter((r) => r.priority === 'medium'),
      low: repo.recommendations.filter((r) => r.priority === 'low'),
    };

    for (const [level, recs] of Object.entries(byCriticality)) {
      if (recs.length === 0) continue;
      md += `#### ${level.charAt(0).toUpperCase() + level.slice(1)} Priority\n\n`;
      for (const rec of recs) {
        md += `- **${rec.template}**\n`;
        md += `  - Reason: ${rec.reason}\n`;
        md += `  - Effort: ${rec.effort}\n`;
        md += `  - Impact: ${rec.impact}\n`;
      }
      md += `\n`;
    }
  }

  return md;
};

const main = (): void => {
  console.log('🎯 Generating template recommendations...');

  // Load data files
  const scanReport = loadJsonFile('dashboard/scan-report.json') as { analyses?: RepoAnalysis[] };
  const qualityScores = loadJsonFile('dashboard/quality-scores.json') as {
    scores?: QualityScore[];
  };
  const costReport = loadJsonFile('dashboard/cost-report.json') as { repos?: CostReport[] };

  if (!scanReport.analyses || scanReport.analyses.length === 0) {
    console.error('❌ No analyses found in scan-report.json');
    process.exit(1);
  }

  const scoreMap = new Map(qualityScores.scores?.map((s) => [s.repo, s]) ?? []);
  const costMap = new Map(costReport.repos?.map((c) => [c.fullName, c]) ?? []);

  // Analyze each repo
  const repoRecommendations = scanReport.analyses
    .map((analysis) =>
      analyzeRepo(analysis, scoreMap.get(analysis.fullName), costMap.get(analysis.fullName))
    )
    .sort((a, b) => b.recommendations.length - a.recommendations.length);

  // Build summary
  const allRecs = repoRecommendations.flatMap((r) => r.recommendations);
  const templateCounts = new Map<string, number>();
  for (const rec of allRecs) {
    templateCounts.set(rec.template, (templateCounts.get(rec.template) ?? 0) + 1);
  }

  const summary = {
    totalRecommendations: allRecs.length,
    criticalCount: allRecs.filter((r) => r.priority === 'critical').length,
    highCount: allRecs.filter((r) => r.priority === 'high').length,
    mediumCount: allRecs.filter((r) => r.priority === 'medium').length,
    lowCount: allRecs.filter((r) => r.priority === 'low').length,
    topTemplates: Array.from(templateCounts.entries())
      .map(([template, count]) => ({ template, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topRepo: repoRecommendations[0]?.repo || 'N/A',
    avgHealthScore:
      repoRecommendations.reduce((sum, r) => sum + r.healthScore, 0) /
      (repoRecommendations.length || 1),
  };

  const report: RecommendationReport = {
    timestamp: new Date().toISOString(),
    repos: repoRecommendations,
    summary,
  };

  // Save JSON report
  writeFileSync('dashboard/recommendations.json', JSON.stringify(report, null, 2));
  console.log(`✅ Saved recommendations.json (${allRecs.length} total recommendations)`);

  // Save markdown report
  const markdown = generateMarkdown(report);
  writeFileSync('dashboard/recommendations.md', markdown);
  console.log(`✅ Saved recommendations.md`);

  // Log activity
  logActivity(
    'scan-and-configure',
    'recommendations-generated',
    `${allRecs.length} recommendations across ${repoRecommendations.length} repos (${summary.criticalCount} critical, ${summary.highCount} high)`,
    'success'
  );

  console.log(`\n📊 Summary:`);
  console.log(`   Total: ${summary.totalRecommendations}`);
  console.log(
    `   Critical: ${summary.criticalCount} | High: ${summary.highCount} | Medium: ${summary.mediumCount} | Low: ${summary.lowCount}`
  );
  console.log(`   Avg Health Score: ${summary.avgHealthScore.toFixed(1)}/100`);
  console.log(`   Top Repo: ${summary.topRepo}`);
};

main();
