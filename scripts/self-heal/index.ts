/**
 * self-heal entry point
 *
 * Analyzes CI failures using pattern database + free AI APIs and creates fix PRs.
 * Run: pnpm self-heal -- --repo owner/name --run-id 123456
 */

import { KNOWN_PROJECTS } from '../../factory.config.js';
import { notify } from '../notify.js';
import { logActivity } from '../activity-logger.js';
import { lookupFix } from '../knowledge-graph.js';
import { sh as _sh } from '../shell-utils.js';
import { AI_PROVIDERS, MAX_ATTEMPTS_BEFORE_ESCALATION } from './constants.js';
import {
  matchPattern,
  recordPatternHit,
  matchedPatternConfidence,
  addNewPattern,
} from './pattern-db.js';
import { checkCooldown, recordAttempt } from './cooldown.js';
import { isCircuitBreakerOpen } from './circuit-breaker.js';
import {
  ghApi,
  fetchFileContent,
  fetchFileWithErrorContext,
  fetchFullFileContent,
  getDefaultBranch,
} from './github-api.js';
import {
  getFailedJobs,
  getAnnotatedFiles,
  getErrorSignature,
  isLikelyFlaky,
  canAutoFixPrettier,
  canAutoFixLockfile,
  findDuplicateDefinitionSiblings,
  fixAmbiguousReferenceDuplicates,
  normalizeLogPath,
  searchFileForClass,
  removeDuplicateClass,
} from './error-analysis.js';
import { askOpenAIProvider, askGemini } from './ai-providers.js';
import { fixWorkflowIssues, fixStyleCopIssues } from './deterministic-fixes.js';
import { createBranch, applyFixes } from './git-operations.js';
import {
  createFixPR,
  tryAutoMerge,
  isDuplicateFix,
  createIssue,
  createEscalationIssue,
} from './pr-management.js';
import { fixLockfileIssues } from './clone-fixers.js';
import { fixPrettierIssues } from './clone-fixers.js';
import type { GeminiFix } from './types.js';

// Re-export for external consumers
export { isFixAlreadyApplied } from './git-operations.js';

const sh = (cmd: string, timeout = 60_000) => _sh(cmd, { timeout });

const parseArgs = (): { repo: string; runId: string } => {
  const args = process.argv.slice(2);
  let repo = '';
  let runId = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
    if (args[i] === '--run-id' && args[i + 1]) runId = args[i + 1];
  }

  if (!repo || !runId) {
    console.error('Usage: tsx scripts/self-heal/index.ts --repo owner/name --run-id 123456');
    process.exit(1);
  }

  return { repo, runId };
};

const main = async (): Promise<void> => {
  const { repo, runId } = parseArgs();
  console.log(`\nSelf-Healing CI for ${repo} (run #${runId})\n`);

  // Skip paused repos (structural issues that can't be auto-fixed)
  const projectConfig = KNOWN_PROJECTS.find((p) => p.repo === repo);
  if (projectConfig?.healingState === 'paused') {
    console.log(`Skipping: ${repo} healingState is "paused" (structural issues)`);
    logActivity('self-heal', 'skip-paused', 'Repo healing state is paused', 'info', repo);
    return;
  }

  // 0. Anti-loop: skip if the failing run is on an ai-fix branch
  const runData = ghApi<{ head_branch?: string }>(`repos/${repo}/actions/runs/${runId}`);
  const headBranch = runData?.head_branch || '';
  if (headBranch.startsWith('ai-fix/')) {
    console.log(`Skipping: run is on branch "${headBranch}" (ai-fix loop prevention)`);
    logActivity('self-heal', 'skip-branch', `Run is on ai-fix branch: ${headBranch}`, 'info', repo);
    return;
  }

  // 1. Get structured errors per failed job
  const jobs = getFailedJobs(repo, runId);
  if (jobs.length === 0) {
    console.log('No failed jobs found');
    logActivity('self-heal', 'no-failures', 'No failed jobs found in run', 'info', repo);
    return;
  }

  const buildJobs = jobs.filter(
    (j) => !j.name.toLowerCase().includes('quality') && !j.name.toLowerCase().includes('lint')
  );

  const defaultBranch = getDefaultBranch(repo);
  console.log(`Default branch: ${defaultBranch}\n`);

  // 0b. Cooldown check
  const errorSig = getErrorSignature(jobs);
  const cooldownResult = checkCooldown(repo, errorSig);
  if (cooldownResult === 'skip') {
    console.log('Cooldown active - skipping');
    return;
  }
  if (cooldownResult === 'escalate') {
    createEscalationIssue(repo, runId, errorSig, MAX_ATTEMPTS_BEFORE_ESCALATION);
    recordAttempt(repo, errorSig, false);
    return;
  }

  // 0c. Circuit breaker
  if (isCircuitBreakerOpen(repo)) {
    console.log('Circuit breaker OPEN - too many unreviewed PRs. Skipping.');
    logActivity('self-heal', 'circuit-breaker', 'Too many unreviewed healing PRs', 'warning', repo);
    notify('circuit_breaker', {
      repo,
      message: 'Too many unreviewed healing PRs — self-heal paused',
    });
    recordAttempt(repo, errorSig, false);
    return;
  }

  // 0d. Flaky test detection
  if (isLikelyFlaky(jobs)) {
    console.log('Likely flaky test detected - re-running failed jobs...');
    logActivity(
      'self-heal',
      'flaky-detected',
      'Flaky test detected, re-triggering failed jobs',
      'info',
      repo
    );
    sh(`gh run rerun ${runId} --repo ${repo} --failed`);
    recordAttempt(repo, errorSig, true);
    console.log('Failed jobs re-triggered for flaky test retry');
    return;
  }

  // 0e. Lockfile fix (deterministic)
  if (canAutoFixLockfile(jobs)) {
    console.log('Lockfile consistency errors detected - fixing inline...');
    const lockfilePrUrl = fixLockfileIssues(repo, runId, defaultBranch);
    if (lockfilePrUrl) {
      console.log(`Lockfile fix PR: ${lockfilePrUrl}`);
      logActivity(
        'self-heal',
        'pr-created',
        `Lockfile fix PR created: ${lockfilePrUrl}`,
        'success',
        repo
      );
      const lockfileConfidence =
        matchedPatternConfidence('lockfile-outdated') ||
        matchedPatternConfidence('npm-lockfile-outdated');
      tryAutoMerge(repo, lockfilePrUrl, 'lockfile-outdated', lockfileConfidence);
    }

    if (buildJobs.length === 0) {
      recordAttempt(repo, errorSig, !!lockfilePrUrl);
      console.log('\nNo build errors beyond lockfile - done!');
      return;
    }
    console.log('\nContinuing with build error analysis...');
  }

  // Handle Prettier failures (deterministic)
  if (canAutoFixPrettier(jobs)) {
    console.log('Prettier formatting errors detected - fixing inline...');
    const prettierPrUrl = fixPrettierIssues(repo, runId, defaultBranch);
    if (prettierPrUrl) {
      console.log(`Prettier fix PR: ${prettierPrUrl}`);
      logActivity(
        'self-heal',
        'pr-created',
        `Prettier fix PR created: ${prettierPrUrl}`,
        'success',
        repo
      );
      tryAutoMerge(
        repo,
        prettierPrUrl,
        'prettier-format-error',
        matchedPatternConfidence('prettier-format-error')
      );
    }

    if (buildJobs.length === 0) {
      console.log('\nNo build errors beyond Prettier - done!');
      return;
    }
    console.log('\nContinuing with build error analysis...');
  }

  const targetJobs = buildJobs.length > 0 ? buildJobs : jobs;

  // 2. Collect files to send to AI
  const fileContents = new Map<string, string>();
  const partialContextFiles = new Set<string>();

  const annotatedFiles = getAnnotatedFiles(targetJobs);
  console.log(`Annotated files: ${[...annotatedFiles].join(', ')}`);

  const errorLinesByFile = new Map<string, number[]>();
  for (const job of targetJobs) {
    for (const a of job.annotations) {
      if (a.path && a.start_line) {
        const existing = errorLinesByFile.get(a.path) || [];
        existing.push(a.start_line);
        errorLinesByFile.set(a.path, existing);
      }
    }
  }

  for (const path of annotatedFiles) {
    const errorLines = errorLinesByFile.get(path) || [];
    const content =
      errorLines.length > 0
        ? fetchFileWithErrorContext(repo, path, defaultBranch, errorLines)
        : fetchFileContent(repo, path, defaultBranch);
    if (content) {
      fileContents.set(path, content);
      if (content.startsWith('// File: ') && content.includes('showing context around errors')) {
        partialContextFiles.add(path);
        console.log(`  Fetched ${path} (${Math.round(content.length / 1024)}KB, partial context)`);
      } else {
        console.log(`  Fetched ${path} (${Math.round(content.length / 1024)}KB)`);
      }
    }
  }

  // 2a2. Deterministic workflow fixes
  const workflowFixes = fixWorkflowIssues(repo, targetJobs, defaultBranch);
  if (workflowFixes.length > 0) {
    console.log(`\nWorkflow fixes found: ${workflowFixes.length}`);
    const allLogsAreWorkflowRelated = targetJobs.every(
      (j) =>
        j.logs.includes('No pnpm version is specified') ||
        j.logs.includes('Please specify it by one of the following ways') ||
        j.logs.match(/\.env[.\w]*: not found/) ||
        (j.logs.includes('semgrep') && j.logs.includes('exit code'))
    );

    if (allLogsAreWorkflowRelated) {
      const branchName = `ai-fix/workflow-${Date.now()}`;
      console.log(`Creating branch: ${branchName}`);

      if (createBranch(repo, branchName, defaultBranch)) {
        const wfExplanation = workflowFixes
          .map((f) => `Fixed workflow issue in ${f.path}`)
          .join('. ');
        const wfChangedFiles = workflowFixes.map((f) => f.path);
        if (isDuplicateFix(repo, 'workflow', wfChangedFiles)) {
          console.log('  [DEDUP] Skipping duplicate fix - workflow PR already closed recently');
          recordAttempt(repo, errorSig, false);
          return;
        }

        console.log('Applying workflow fixes...');
        const applied = applyFixes(repo, branchName, defaultBranch, workflowFixes);
        if (applied) {
          const prUrl = createFixPR(repo, branchName, defaultBranch, runId, wfExplanation);
          console.log(`\nWorkflow fix PR: ${prUrl}`);
          logActivity(
            'self-heal',
            'pr-created',
            `Workflow fix PR created: ${prUrl}`,
            'success',
            repo
          );
          recordAttempt(repo, errorSig, true);
          tryAutoMerge(repo, prUrl, undefined, 0.95);
          return;
        }
      }
    }
  }

  // 2b. Deterministic fixes for duplicate definitions
  const deterministicFixes: GeminiFix[] = [...workflowFixes];
  const duplicateSiblings = findDuplicateDefinitionSiblings(repo, targetJobs, defaultBranch);

  for (const [className, siblingPaths] of duplicateSiblings) {
    for (const sibPath of siblingPaths) {
      const fragment = searchFileForClass(repo, sibPath, className, defaultBranch);
      if (!fragment) continue;

      const fix = removeDuplicateClass(repo, sibPath, className, defaultBranch);
      if (fix) {
        deterministicFixes.push(fix);
        console.log(`  Deterministic fix ready for ${sibPath}`);
      } else {
        fileContents.set(sibPath, fragment);
      }
    }
  }

  // 2b2. CS0104 ambiguous references
  const ambiguousFixes = fixAmbiguousReferenceDuplicates(repo, targetJobs, defaultBranch);
  deterministicFixes.push(...ambiguousFixes);

  // 2c. StyleCop fixes
  const stylecopFixes = fixStyleCopIssues(repo, targetJobs, defaultBranch);
  deterministicFixes.push(...stylecopFixes);

  // 3. Build explanation for deterministic fixes
  const allFixes: GeminiFix[] = [...deterministicFixes];
  let usedPatternId: string | undefined;
  let usedAiProvider: string | undefined;
  let usedPatternSignature: string | undefined;
  let explanation = '';

  if (deterministicFixes.length > 0) {
    const parts: string[] = [];
    const dupFixes = deterministicFixes.filter(
      (f) => !stylecopFixes.includes(f) && !ambiguousFixes.includes(f)
    );
    if (dupFixes.length > 0)
      parts.push(dupFixes.map((f) => `Removed duplicate class from ${f.path}`).join('. '));
    if (ambiguousFixes.length > 0)
      parts.push(
        ambiguousFixes
          .map((f) => `Removed duplicate type causing CS0104 ambiguity from ${f.path}`)
          .join('. ')
      );
    if (stylecopFixes.length > 0)
      parts.push(`Fixed StyleCop issues in ${stylecopFixes.map((f) => f.path).join(', ')}`);
    explanation = parts.join('. ');
    console.log(`\nDeterministic fixes: ${deterministicFixes.length}`);
  }

  // 4. AI analysis for remaining errors
  const hasNonDuplicateErrors = targetJobs.some((j) =>
    j.annotations.some(
      (a) =>
        !a.message.includes('already contains a definition') &&
        !a.message.includes('already defines a member') &&
        !a.message.includes('is an ambiguous reference between')
    )
  );

  const hasLogsWithoutAnnotations =
    targetJobs.some((j) => j.logs.length > 0) &&
    targetJobs.every((j) => j.annotations.length === 0);

  if (hasLogsWithoutAnnotations && fileContents.size === 0) {
    const logText = targetJobs.map((j) => j.logs).join('\n');
    const extractedPaths = new Set<string>();

    const logErrorLines = new Map<string, number[]>();
    const errorLocWithLinePattern = /([\w/.+:\\-]+\.(?:ts|tsx|js|jsx|cs))\((\d+)/g;
    let locMatch: RegExpExecArray | null;
    while ((locMatch = errorLocWithLinePattern.exec(logText)) !== null) {
      const p = normalizeLogPath(locMatch[1]);
      const lineNum = Number(locMatch[2]);
      const existing = logErrorLines.get(p) || [];
      existing.push(lineNum);
      logErrorLines.set(p, existing);
      extractedPaths.add(p);
    }

    const csprojPattern = /\[([\w/.+:\\-]+\.csproj)\]/g;
    const generalPattern = /(?:^|\s)([\w/.+-]+\.(?:ts|tsx|js|jsx|cs|csproj))(?=[\s(:]|$)/gm;

    for (const pattern of [csprojPattern, generalPattern]) {
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

    for (const path of [...extractedPaths].slice(0, 10)) {
      const errorLines = logErrorLines.get(path) || [];
      const content =
        errorLines.length > 0
          ? fetchFileWithErrorContext(repo, path, defaultBranch, errorLines)
          : fetchFileContent(repo, path, defaultBranch);
      if (content) {
        fileContents.set(path, content);
        if (content.startsWith('// File: ') && content.includes('showing context around errors')) {
          partialContextFiles.add(path);
          console.log(
            `  Fetched ${path} (${Math.round(content.length / 1024)}KB, partial context)`
          );
        } else {
          console.log(`  Fetched ${path} (${Math.round(content.length / 1024)}KB)`);
        }
      }
    }
  }

  if (
    (hasNonDuplicateErrors || hasLogsWithoutAnnotations) &&
    (fileContents.size > 0 || hasLogsWithoutAnnotations)
  ) {
    const matchedPattern = matchPattern(targetJobs);
    let patternHint = '';

    if (matchedPattern) {
      console.log(
        `\nPattern DB hit: "${matchedPattern.id}" (${matchedPattern.confidence}) - ${matchedPattern.fix}`
      );
      usedPatternId = matchedPattern.id;
      usedPatternSignature = matchedPattern.signature;
      patternHint = `\n\n## Known Pattern\nThis error matches known pattern "${matchedPattern.id}".\nKnown fix: ${matchedPattern.fix}\nApply this fix approach to the source files below.\n`;
    }

    if (usedPatternId) {
      const projectStack = KNOWN_PROJECTS.find((p) => p.repo === repo)?.stack ?? 'unknown';
      const knownFix = lookupFix(usedPatternId, projectStack);
      if (knownFix) {
        console.log(
          `\n[KG] Reusing validated fix from ${knownFix.repo} PR #${knownFix.prNumber} (pattern: ${knownFix.patternId})`
        );
        for (const filePath of knownFix.filePaths) {
          const original = fetchFullFileContent(repo, filePath, defaultBranch);
          if (original) {
            fileContents.set(filePath, original);
          }
        }
        explanation += `Reused validated fix from knowledge graph (${knownFix.repo} PR #${knownFix.prNumber}). `;
        usedAiProvider = 'knowledge-graph';
        patternHint += `\n\n## Validated Fix (from knowledge graph)\nA verified fix for this exact pattern+stack exists:\n\`\`\`diff\n${knownFix.diff.slice(0, 3000)}\n\`\`\`\nApply the same approach to the current repo.\n`;
      }
    }

    console.log(`\nTotal files for AI analysis: ${fileContents.size}`);
    let aiResponse = { fixes: [] as GeminiFix[], explanation: '' };

    for (const provider of AI_PROVIDERS) {
      const result = await askOpenAIProvider(provider, targetJobs, fileContents, patternHint);
      if (result.fixes.length > 0) {
        console.log(`${provider.name}: ${result.explanation}`);
        aiResponse = result;
        usedAiProvider = `${provider.name} (${provider.model})`;
        break;
      }
      console.log(`${provider.name}: no fixes, trying next provider...`);
    }

    if (aiResponse.fixes.length === 0) {
      console.log('All OpenAI-compatible providers failed, trying Gemini...');
      aiResponse = await askGemini(targetJobs, fileContents, patternHint);
      console.log(`Gemini: ${aiResponse.explanation}`);
    }

    for (const fix of aiResponse.fixes) {
      if (fix.replacements && fix.replacements.length > 0) {
        allFixes.push(fix);
        continue;
      }
      if (!fix.content) {
        console.warn(`  Rejected fix for ${fix.path}: no content or replacements`);
        continue;
      }
      if (partialContextFiles.has(fix.path)) {
        console.warn(
          `  Rejected content fix for ${fix.path}: file was sent as partial context, expected replacements format`
        );
        continue;
      }
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

    if (matchedPattern) {
      recordPatternHit(matchedPattern.id, repo, aiResponse.fixes.length > 0);
    } else if (aiResponse.fixes.length > 0) {
      const firstError = targetJobs
        .flatMap((j) => j.annotations)
        .find(
          (a) =>
            !a.message.includes('already contains a definition') &&
            !a.message.includes('already defines a member') &&
            !a.message.includes('is an ambiguous reference between') &&
            !a.message.startsWith('Process completed with exit code')
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
    recordAttempt(repo, errorSig, false);
    return;
  }

  const branchName = `ai-fix/ci-${Date.now()}`;
  console.log(`\nCreating branch: ${branchName}`);

  if (!createBranch(repo, branchName, defaultBranch)) {
    console.error('Failed to create branch');
    createIssue(repo, runId, explanation);
    recordAttempt(repo, errorSig, false);
    return;
  }

  console.log('Applying fixes...');
  const applied = applyFixes(repo, branchName, defaultBranch, allFixes);
  if (!applied) {
    console.error('All fixes failed to apply');
    createIssue(
      repo,
      runId,
      `${explanation}\n\n**Note**: Auto-fix attempted but all replacements failed to apply.`
    );
    recordAttempt(repo, errorSig, false);
    return;
  }

  const fixChangedFiles = allFixes.map((f) => f.path);
  const dedupPattern = usedPatternId ? `pattern:${usedPatternId}` : 'AI-generated CI fix';
  if (isDuplicateFix(repo, dedupPattern, fixChangedFiles)) {
    console.log('  [DEDUP] Skipping duplicate fix - similar PR already closed recently');
    recordAttempt(repo, errorSig, false);
    return;
  }

  const prUrl = createFixPR(
    repo,
    branchName,
    defaultBranch,
    runId,
    explanation,
    usedPatternId,
    usedAiProvider,
    usedPatternSignature
  );
  const prValid = prUrl.includes('github.com') && prUrl.includes('/pull/');
  if (!prValid) {
    console.error(`PR creation failed (got: ${prUrl.slice(0, 100)})`);
    createIssue(
      repo,
      runId,
      `${explanation}\n\n**Note**: Fix applied to branch \`${branchName}\` but PR creation failed.`
    );
    recordAttempt(repo, errorSig, false);
    return;
  }
  console.log(`\nPR created: ${prUrl}`);
  logActivity('self-heal', 'pr-created', `CI fix PR created: ${prUrl}`, 'success', repo);
  recordAttempt(repo, errorSig, true);
  notify('pr_created', {
    repo,
    prUrl,
    patternId: usedPatternId,
    confidence: usedPatternId ? matchedPatternConfidence(usedPatternId) : undefined,
  });

  const patternConfidence = usedPatternId ? matchedPatternConfidence(usedPatternId) : 0;
  tryAutoMerge(repo, prUrl, usedPatternId, patternConfidence);

  console.log('\nDone!');
};

main().catch((err) => {
  console.error('Self-heal failed:', err);
  process.exit(1);
});
