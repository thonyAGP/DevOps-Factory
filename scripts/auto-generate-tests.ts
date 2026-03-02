/**
 * auto-generate-tests.ts
 *
 * Automatically generates unit tests for files with 0% coverage.
 * Uses Claude API to generate high-quality, meaningful tests.
 *
 * Features:
 * - Finds TypeScript files without corresponding test files
 * - Generates tests using optimized prompts (learned from existing tests)
 * - Validates generated tests pass before committing
 * - Auto-rollback on failure
 * - Commits tests automatically with descriptive messages
 *
 * Usage:
 *   pnpm auto-generate-tests                    # Scan current project
 *   pnpm auto-generate-tests -- --project ../CasaSync
 *   pnpm auto-generate-tests -- --dry-run       # Preview only
 *   pnpm auto-generate-tests -- --limit 5       # Max 5 files
 *
 * Environment:
 *   ANTHROPIC_API_KEY: Required
 *   AUTO_GEN_MODEL: claude-haiku-4-5 (default) or claude-sonnet-4-5
 *   AUTO_GEN_MAX_FILES: Max files per run (default: 10)
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { glob } from 'glob';
import { relative } from 'node:path';
import { logActivity } from './activity-logger.js';

// === Configuration ===

interface Config {
  projectPath: string;
  model: string;
  maxFiles: number;
  dryRun: boolean;
  autoCommit: boolean;
  requireValidation: boolean;
}

const parseArgs = (): Config => {
  const args = process.argv.slice(2);
  const config: Config = {
    projectPath: process.cwd(),
    model: process.env.AUTO_GEN_MODEL || 'claude-haiku-4-5',
    maxFiles: parseInt(process.env.AUTO_GEN_MAX_FILES || '10', 10),
    dryRun: false,
    autoCommit: true,
    requireValidation: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project':
        config.projectPath = args[i + 1] || config.projectPath;
        i++;
        break;
      case '--model':
        config.model = args[i + 1] || config.model;
        i++;
        break;
      case '--limit':
        config.maxFiles = parseInt(args[i + 1] || '10', 10);
        i++;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--no-commit':
        config.autoCommit = false;
        break;
      case '--no-validation':
        config.requireValidation = false;
        break;
    }
  }

  return config;
};

// === API Client ===

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// === Shell Utils ===

const sh = (cmd: string, cwd?: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, timeout: 120000 }).trim();
  } catch {
    return '';
  }
};

const shOrFail = (cmd: string, cwd?: string): string => {
  return execSync(cmd, { encoding: 'utf-8', cwd, timeout: 120000 }).trim();
};

// === Core Logic ===

interface FileToTest {
  sourcePath: string;
  testPath: string;
  relativeSource: string;
  relativeTest: string;
}

interface GenerationResult {
  file: FileToTest;
  testCode: string;
  testCount: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  validated: boolean;
  error?: string;
}

interface Summary {
  totalFiles: number;
  testsGenerated: number;
  testsValidated: number;
  testsFailed: number;
  totalTests: number;
  totalCost: number;
  duration: number;
}

const findFilesWithoutTests = async (projectPath: string): Promise<FileToTest[]> => {
  console.log(`\n🔍 Scanning ${projectPath} for files without tests...\n`);

  // Find all .ts files (not test files, not in node_modules)
  const tsFiles = await glob('**/*.ts', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
    absolute: true,
  });

  const filesWithoutTests: FileToTest[] = [];

  for (const sourceFile of tsFiles) {
    const testFile = sourceFile.replace(/\.ts$/, '.test.ts');
    const specFile = sourceFile.replace(/\.ts$/, '.spec.ts');

    if (!existsSync(testFile) && !existsSync(specFile)) {
      filesWithoutTests.push({
        sourcePath: sourceFile,
        testPath: testFile,
        relativeSource: relative(projectPath, sourceFile),
        relativeTest: relative(projectPath, testFile),
      });
    }
  }

  console.log(`Found ${filesWithoutTests.length} files without tests:`);
  filesWithoutTests.slice(0, 10).forEach((f) => console.log(`  - ${f.relativeSource}`));
  if (filesWithoutTests.length > 10) {
    console.log(`  ... and ${filesWithoutTests.length - 10} more`);
  }

  return filesWithoutTests;
};

const SYSTEM_PROMPT = `You are an expert TypeScript/JavaScript test engineer specializing in generating high-quality, meaningful unit tests.

Your goal: Generate tests that provide REAL VALUE, not just coverage percentage.

GENERATION CRITERIA (CRITICAL):
1. ✅ Generate tests for:
   - Functions with business logic (conditionals, loops, transformations)
   - Functions with multiple code paths (if/switch statements)
   - Edge cases (null, undefined, empty arrays, boundary conditions)
   - Error handling paths
   - Pure functions with predictable I/O

2. ❌ DO NOT generate tests for:
   - Simple getters/setters without logic
   - One-liner wrapper functions
   - Type definitions/interfaces
   - Constants/config objects
   - Functions that only delegate to other functions

TEST QUALITY REQUIREMENTS:
- Use AAA pattern (Arrange, Act, Assert)
- Descriptive test names: "should [behavior] when [condition]"
- Test edge cases and error conditions
- Isolate tests (no side effects, no shared state)
- Mock external dependencies (APIs, file system, databases)
- Keep tests focused (one assertion per test when possible)

OUTPUT FORMAT:
Return a JSON object with this structure:
{
  "shouldGenerate": boolean,
  "reasoning": "Explain why you decided to generate or skip",
  "testCount": number,
  "testCode": "Complete test file content with imports and describe blocks"
}

If shouldGenerate is false, return testCode as empty string.

IMPORTANT:
- Always include proper TypeScript imports
- Use Vitest framework (import from 'vitest')
- Follow existing test patterns from the codebase
- Generate complete, runnable test files`;

const generateTestPrompt = (sourceCode: string, filePath: string): string => `
Analyze this TypeScript file and generate comprehensive unit tests if appropriate.

**File**: ${filePath}

**Source Code**:
\`\`\`typescript
${sourceCode}
\`\`\`

Generate tests following these guidelines:
1. Focus on testable business logic, not trivial code
2. Cover happy paths, edge cases, and error scenarios
3. Use descriptive test names
4. Follow AAA pattern
5. Ensure tests are isolated and deterministic

Return JSON with shouldGenerate, reasoning, testCount, and testCode.
`;

const generateTestForFile = async (
  file: FileToTest,
  model: string
): Promise<GenerationResult | null> => {
  console.log(`\n📝 Generating tests for: ${file.relativeSource}`);

  const sourceCode = readFileSync(file.sourcePath, 'utf-8');

  // Quick filter: skip very small files or files without exports
  if (sourceCode.length < 100 || !sourceCode.includes('export')) {
    console.log(`  ⏭️  Skipped (too small or no exports)`);
    return null;
  }

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: generateTestPrompt(sourceCode, file.relativeSource),
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    // Parse JSON response
    const llmResponse = JSON.parse(content.text);

    if (!llmResponse.shouldGenerate) {
      console.log(`  ⏭️  Skipped: ${llmResponse.reasoning}`);
      return null;
    }

    // Calculate cost
    const costUsd = calculateCost(response.usage.input_tokens, response.usage.output_tokens, model);

    console.log(`  ✅ Generated ${llmResponse.testCount} tests`);
    console.log(`  💰 Cost: $${costUsd.toFixed(4)}`);

    return {
      file,
      testCode: llmResponse.testCode,
      testCount: llmResponse.testCount,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      costUsd,
      validated: false,
    };
  } catch (error) {
    console.error(`  ❌ Error: ${error}`);
    return {
      file,
      testCode: '',
      testCount: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
      validated: false,
      error: String(error),
    };
  }
};

const calculateCost = (inputTokens: number, outputTokens: number, model: string): number => {
  // Pricing as of March 2024
  const prices: Record<string, { input: number; output: number }> = {
    'claude-haiku-4-5': { input: 0.25, output: 1.25 }, // per MTok
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-opus-4': { input: 15.0, output: 75.0 },
  };

  const price = prices[model] || prices['claude-haiku-4-5'];

  const costInput = (inputTokens / 1_000_000) * price.input;
  const costOutput = (outputTokens / 1_000_000) * price.output;

  return costInput + costOutput;
};

const validateTest = async (result: GenerationResult, projectPath: string): Promise<boolean> => {
  if (!result.testCode) return false;

  console.log(`\n🧪 Validating test: ${result.file.relativeTest}`);

  try {
    // Write test file
    writeFileSync(result.file.testPath, result.testCode);

    // Run the test
    const testOutput = sh(`pnpm test ${result.file.relativeTest}`, projectPath);

    // Check if test passed
    const passed = testOutput.includes('passed') && !testOutput.includes('failed');

    if (passed) {
      console.log(`  ✅ Test passes`);
      result.validated = true;
      return true;
    } else {
      console.log(`  ❌ Test fails - rolling back`);
      unlinkSync(result.file.testPath);
      result.validated = false;
      result.error = 'Test execution failed';
      return false;
    }
  } catch (error) {
    console.error(`  ❌ Validation error: ${error}`);
    if (existsSync(result.file.testPath)) {
      unlinkSync(result.file.testPath);
    }
    result.validated = false;
    result.error = String(error);
    return false;
  }
};

const commitGeneratedTests = async (
  results: GenerationResult[],
  projectPath: string
): Promise<void> => {
  const validTests = results.filter((r) => r.validated);

  if (validTests.length === 0) {
    console.log('\n⚠️  No tests to commit');
    return;
  }

  console.log(`\n📦 Committing ${validTests.length} generated tests...`);

  try {
    // Add all test files
    const testFiles = validTests.map((r) => r.file.relativeTest).join(' ');
    shOrFail(`git add ${testFiles}`, projectPath);

    // Create commit message
    const totalTests = validTests.reduce((sum, r) => sum + r.testCount, 0);
    const totalCost = validTests.reduce((sum, r) => sum + r.costUsd, 0);

    const commitMessage = `test: auto-generate ${validTests.length} test files (+${totalTests} tests)

Generated tests for files with 0% coverage:
${validTests.map((r) => `- ${r.file.relativeSource}: ${r.testCount} tests`).join('\n')}

Total: ${totalTests} tests generated
Cost: $${totalCost.toFixed(4)}

All tests validated and passing.
Auto-generated by DevOps-Factory.

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>`;

    shOrFail(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, projectPath);

    console.log(`  ✅ Commit created`);

    // Log activity
    logActivity(
      'recommendation-engine',
      'auto-generate-tests',
      `Generated ${validTests.length} test files with ${totalTests} tests`,
      'success'
    );
  } catch (error) {
    console.error(`  ❌ Commit failed: ${error}`);
    throw error;
  }
};

// === Main ===

const main = async () => {
  const startTime = Date.now();
  const config = parseArgs();

  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║        Auto Test Generator - DevOps Factory          ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log(`Project: ${config.projectPath}`);
  console.log(`Model: ${config.model}`);
  console.log(`Max files: ${config.maxFiles}`);
  console.log(`Dry run: ${config.dryRun}`);
  console.log(`Auto commit: ${config.autoCommit}`);

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n❌ Error: ANTHROPIC_API_KEY environment variable is required');
    console.error('Set it in .env file or export it:\n');
    console.error('  export ANTHROPIC_API_KEY=sk-ant-...\n');
    process.exit(1);
  }

  // Find files without tests
  const filesToTest = await findFilesWithoutTests(config.projectPath);

  if (filesToTest.length === 0) {
    console.log('\n✅ All files have tests! Nothing to do.');
    return;
  }

  // Limit number of files
  const targetFiles = filesToTest.slice(0, config.maxFiles);

  if (targetFiles.length < filesToTest.length) {
    console.log(
      `\n⚠️  Processing first ${config.maxFiles} files (${filesToTest.length - config.maxFiles} remaining)`
    );
  }

  console.log(`\n🎯 Target: ${targetFiles.length} files\n`);

  // Generate tests
  const results: GenerationResult[] = [];

  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    console.log(`\n[${i + 1}/${targetFiles.length}] ${file.relativeSource}`);

    const result = await generateTestForFile(file, config.model);

    if (result) {
      results.push(result);

      if (!config.dryRun && config.requireValidation) {
        await validateTest(result, config.projectPath);
      }
    }

    // Rate limiting: small delay between API calls
    if (i < targetFiles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Summary
  const duration = Date.now() - startTime;
  const summary: Summary = {
    totalFiles: targetFiles.length,
    testsGenerated: results.filter((r) => r.testCode).length,
    testsValidated: results.filter((r) => r.validated).length,
    testsFailed: results.filter((r) => r.error).length,
    totalTests: results.reduce((sum, r) => sum + r.testCount, 0),
    totalCost: results.reduce((sum, r) => sum + r.costUsd, 0),
    duration: Math.round(duration / 1000),
  };

  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║                     SUMMARY                           ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log(`Files analyzed:       ${summary.totalFiles}`);
  console.log(`Tests generated:      ${summary.testsGenerated}`);
  console.log(`Tests validated:      ${summary.testsValidated} ✅`);
  console.log(`Tests failed:         ${summary.testsFailed} ❌`);
  console.log(`Total tests created:  ${summary.totalTests}`);
  console.log(`Total cost:           $${summary.totalCost.toFixed(4)}`);
  console.log(`Duration:             ${summary.duration}s`);

  // Commit if auto-commit enabled
  if (!config.dryRun && config.autoCommit && summary.testsValidated > 0) {
    await commitGeneratedTests(results, config.projectPath);
  }

  if (config.dryRun) {
    console.log('\n💡 Dry run mode - no files written');
  }

  console.log('\n✅ Done!\n');
};

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
