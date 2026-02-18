/**
 * test-scaffold.ts
 *
 * Generates skeleton test files for source files without corresponding tests.
 * Scans repos with Node/Next.js/Fastify stacks for uncovered source files,
 * extracts exported functions/classes, and creates test scaffolds via PR.
 *
 * Run: pnpm test-scaffold
 */

import { execSync } from 'node:child_process';
import { KNOWN_PROJECTS, GITHUB_OWNER } from '../factory.config.js';

interface TreeNode {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url?: string;
}

interface TestFile {
  path: string;
  content: string;
  sourcePath: string;
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
};

const ghApi = <T>(cmd: string): T => {
  const result = sh(`gh api ${cmd}`);
  return result ? (JSON.parse(result) as T) : ({} as T);
};

const isSkippedDir = (path: string): boolean => {
  const skipped = ['node_modules', '.next', 'dist', 'build', '.git', 'coverage'];
  return skipped.some((dir) => path.includes(`/${dir}/`) || path.startsWith(`${dir}/`));
};

const isSkippedFile = (path: string): boolean => {
  const skipped = [/\.d\.ts$/, /\.config\.(ts|tsx|js)$/, /index\.ts$/, /index\.tsx$/];
  return skipped.some((pattern) => pattern.test(path));
};

const getRepoTree = (repo: string, branch: string): TreeNode[] => {
  const response = ghApi<{ tree: TreeNode[] }>(`repos/${repo}/git/trees/${branch}?recursive=1`);
  return response.tree || [];
};

const findSourceFiles = (tree: TreeNode[]): string[] => {
  return tree
    .filter(
      (node): node is TreeNode & { path: string } =>
        node.type === 'blob' &&
        /\.(ts|tsx)$/.test(node.path) &&
        /^src\//.test(node.path) &&
        !isSkippedDir(node.path) &&
        !isSkippedFile(node.path)
    )
    .map((node) => node.path);
};

const findUncoveredFiles = (sourceFiles: string[], allFiles: string[]): string[] => {
  return sourceFiles.filter((sourcePath) => {
    const testPath1 = sourcePath.replace(/\.(ts|tsx)$/, '.test.$1');
    const testPath2 = sourcePath.replace(/\.(ts|tsx)$/, '.spec.$1');
    return !allFiles.includes(testPath1) && !allFiles.includes(testPath2);
  });
};

const fetchFileContent = (repo: string, filePath: string): string => {
  const response = ghApi<{ content: string }>(`repos/${repo}/contents/${filePath}`);
  return response.content ? Buffer.from(response.content, 'base64').toString() : '';
};

const extractExports = (content: string): string[] => {
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+(?:default\s+)?(?:interface|type)\s+(\w+)/g,
  ];

  const exports = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      exports.add(match[1]);
    }
  }

  return Array.from(exports).filter((name) => name && name !== 'default');
};

const generateTestSkeleton = (filePath: string, exports: string[]): string => {
  const importPath = filePath.replace(/\.(ts|tsx)$/, '');
  const fileName = importPath.split('/').pop() || 'module';

  let content = `import { describe, it, expect } from 'vitest';\n`;
  content += `// TODO: import from '${importPath}';\n\n`;

  content += `describe('${fileName}', () => {\n`;

  if (exports.length > 0) {
    for (const exp of exports) {
      content += `  it.todo('should test ${exp}');\n`;
    }
  } else {
    content += `  it.todo('should test exported functionality');\n`;
  }

  content += `});\n`;

  return content;
};

const createScaffoldPR = (repo: string, testFiles: TestFile[]): boolean => {
  if (testFiles.length === 0) {
    console.log(`  [SKIP] ${repo}: no uncovered files`);
    return false;
  }

  const maxFiles = 10;
  if (testFiles.length > maxFiles) {
    console.log(`  [SKIP] ${repo}: ${testFiles.length} files exceed max (${maxFiles})`);
    return false;
  }

  const branchName = 'devops-factory/test-scaffold';
  const repoFullName = `${GITHUB_OWNER}/${repo}`;

  // Check if PR already exists
  const existingPR = sh(
    `gh pr list --repo "${repoFullName}" --head "${branchName}" --json number --jq '.[0].number' 2>/dev/null`
  );

  if (existingPR) {
    console.log(`  [SKIP] ${repo}: PR #${existingPR} already exists`);
    return false;
  }

  console.log(`  [CREATE] ${repo}: generating test skeletons for ${testFiles.length} files`);

  // Get default branch
  const response = ghApi<{ default_branch: string }>(`repos/${repoFullName}`);
  const defaultBranch = response.default_branch || 'main';

  // Get base SHA
  const refResponse = ghApi<{ object: { sha: string } }>(
    `repos/${repoFullName}/git/ref/heads/${defaultBranch}`
  );
  const baseSha = refResponse.object?.sha;

  if (!baseSha) {
    console.log(`  [ERROR] ${repo}: cannot get base SHA`);
    return false;
  }

  // Create branch
  sh(
    `gh api repos/${repoFullName}/git/refs --method POST -f ref="refs/heads/${branchName}" -f sha="${baseSha}" 2>/dev/null`
  );

  // Add test files via GitHub API
  for (const testFile of testFiles) {
    const encoded = Buffer.from(testFile.content).toString('base64');
    sh(
      `gh api repos/${repoFullName}/contents/${testFile.path} --method PUT ` +
        `-f message="test: add skeleton tests for ${testFile.sourcePath}" ` +
        `-f content="${encoded}" ` +
        `-f branch="${branchName}" 2>/dev/null`
    );
  }

  // Create PR
  const fileList = testFiles.map((f) => `- \`${f.path}\` (from \`${f.sourcePath}\`)`).join('\n');
  const body = `## Test Scaffold Generation

Generated skeleton test files for uncovered source files.

### Files added
${fileList}

### What's next
1. Review the test stubs
2. Implement actual test cases based on the exported functions/classes
3. Merge and run \`pnpm test\` to verify

> Auto-generated by [DevOps-Factory Test Scaffold](https://github.com/thonyAGP/DevOps-Factory)`;

  sh(
    `gh pr create --repo "${repoFullName}" --head "${branchName}" --base "${defaultBranch}" ` +
      `--title "test: add skeleton test files" --body "${body.replace(/"/g, '\\"')}" 2>/dev/null`
  );

  return true;
};

const processRepo = (repo: string): void => {
  const fullName = `${GITHUB_OWNER}/${repo}`;

  // Get default branch
  const response = ghApi<{ default_branch: string }>(`repos/${fullName}`);
  const defaultBranch = response.default_branch || 'main';

  // Fetch file tree
  const tree = getRepoTree(fullName, defaultBranch);
  const allFiles = tree
    .filter((node): node is TreeNode & { path: string } => node.type === 'blob' && !!node.path)
    .map((node) => node.path);

  const sourceFiles = findSourceFiles(tree);
  const uncoveredFiles = findUncoveredFiles(sourceFiles, allFiles);

  if (uncoveredFiles.length === 0) {
    console.log(`  [SKIP] ${repo}: all source files have tests`);
    return;
  }

  // Generate test skeletons
  const testFiles: TestFile[] = [];

  for (const sourcePath of uncoveredFiles) {
    const content = fetchFileContent(fullName, sourcePath);
    if (!content) continue;

    const exports = extractExports(content);
    const testContent = generateTestSkeleton(sourcePath, exports);
    const testPath = sourcePath.replace(/\.(ts|tsx)$/, '.test.$1');

    testFiles.push({
      path: testPath,
      content: testContent,
      sourcePath,
    });
  }

  createScaffoldPR(repo, testFiles);
};

const main = (): void => {
  console.log('DevOps-Factory: Generating test scaffolds...\n');

  const nodeProjects = KNOWN_PROJECTS.filter(
    (p) => p.stack === 'node' || p.stack === 'nextjs' || p.stack === 'fastify'
  );

  console.log(`Found ${nodeProjects.length} Node.js projects\n`);

  for (const project of nodeProjects) {
    console.log(`Processing: ${project.name}...`);
    processRepo(project.repo.split('/')[1]);
  }

  console.log('\nTest scaffold generation complete.');
};

main();
