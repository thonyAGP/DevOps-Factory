import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { sh as _sh, tmpDir } from '../shell-utils.js';
import { ghApi, fetchFullFileContent } from './github-api.js';
import type { GeminiFix } from './types.js';

const sh = (cmd: string, timeout = 60_000) => _sh(cmd, { timeout });

export const configureGitAuth = (workDir: string, repo: string) => {
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (ghToken) {
    execSync(`git remote set-url origin https://x-access-token:${ghToken}@github.com/${repo}.git`, {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  }
};

export const createBranch = (repo: string, branchName: string, baseBranch: string): boolean => {
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

export const createBlob = (repo: string, content: string): string | null => {
  const tmpFile = `self-heal-blob-${Date.now()}.json`;
  writeFileSync(tmpFile, JSON.stringify({ content, encoding: 'utf-8' }));
  const result = sh(`gh api repos/${repo}/git/blobs --input ${tmpFile}`);
  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }
  try {
    return (JSON.parse(result) as { sha: string }).sha;
  } catch {
    return null;
  }
};

export const uploadFilesBatch = (
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  commitMessage: string
): boolean => {
  const tmpFile = `self-heal-api-${Date.now()}.json`;

  try {
    const blobs: Array<{ path: string; sha: string }> = [];
    for (const file of files) {
      console.log(`  Creating blob for ${file.path}...`);
      const sha = createBlob(repo, file.content);
      if (!sha) {
        console.error(`  Failed to create blob for ${file.path}`);
        return false;
      }
      blobs.push({ path: file.path, sha });
    }

    const refData = ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${branch}`);
    if (!refData) return false;

    const commitData = ghApi<{ tree: { sha: string } }>(
      `repos/${repo}/git/commits/${refData.object.sha}`
    );
    if (!commitData) return false;

    writeFileSync(
      tmpFile,
      JSON.stringify({
        base_tree: commitData.tree.sha,
        tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
      })
    );
    const treeResult = sh(`gh api repos/${repo}/git/trees --input ${tmpFile}`);

    let treeSha: string;
    try {
      treeSha = (JSON.parse(treeResult) as { sha: string }).sha;
    } catch {
      console.error('  Failed to create tree');
      return false;
    }

    writeFileSync(
      tmpFile,
      JSON.stringify({
        message: commitMessage,
        tree: treeSha,
        parents: [refData.object.sha],
      })
    );
    const newCommitResult = sh(`gh api repos/${repo}/git/commits --input ${tmpFile}`);

    let newCommitSha: string;
    try {
      newCommitSha = (JSON.parse(newCommitResult) as { sha: string }).sha;
    } catch {
      console.error('  Failed to create commit');
      return false;
    }

    const updateResult = sh(
      `gh api repos/${repo}/git/refs/heads/${branch} -X PATCH -f sha="${newCommitSha}"`
    );
    return updateResult.includes(newCommitSha);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
};

export const applyFixes = (
  repo: string,
  branch: string,
  baseBranch: string,
  fixes: GeminiFix[]
): boolean => {
  let success = true;
  const filesToUpload: Array<{ path: string; content: string }> = [];

  for (const fix of fixes) {
    let finalContent = fix.content;

    if (fix.replacements && fix.replacements.length > 0) {
      const fullContent = fetchFullFileContent(repo, fix.path, baseBranch);
      if (!fullContent) {
        console.error(`  Cannot fetch full ${fix.path} for replacement`);
        success = false;
        continue;
      }
      finalContent = fullContent;
      let applied = 0;
      for (const r of fix.replacements) {
        if (!finalContent.includes(r.search)) {
          console.warn(
            `  Replacement search text not found in ${fix.path}: "${r.search.slice(0, 60)}..."`
          );
          continue;
        }
        finalContent = finalContent.replace(r.search, r.replace);
        applied++;
      }
      if (applied === 0) {
        console.warn(`  No replacements applied in ${fix.path}, skipping`);
        continue;
      }
      if (applied < fix.replacements.length) {
        console.warn(
          `  Only ${applied}/${fix.replacements.length} replacements applied in ${fix.path}, rejecting partial fix`
        );
        success = false;
        continue;
      }
    }

    const currentContent = fetchFullFileContent(repo, fix.path, baseBranch);
    if (currentContent !== null && currentContent === finalContent) {
      console.log(`  [PRE-CHECK] Fix already applied in ${fix.path}, skipping`);
      continue;
    }

    console.log(`  Preparing fix for ${fix.path} (${Math.round(finalContent.length / 1024)}KB)...`);
    filesToUpload.push({ path: fix.path, content: finalContent });
  }

  if (filesToUpload.length === 0) {
    console.log('  [PRE-CHECK] All fixes already applied, skipping PR creation');
    return false;
  }

  console.log(`  Uploading ${filesToUpload.length} file(s) in single atomic commit...`);
  const ok = uploadFilesBatch(repo, branch, filesToUpload, 'fix: AI-generated fix for CI failure');
  if (!ok) {
    console.error('  Batch upload failed');
    return false;
  }

  return success;
};

export const isFixAlreadyApplied = (
  repo: string,
  baseBranch: string,
  fixes: Array<{ path: string; content: string }>
): boolean => {
  if (fixes.length === 0) return true;

  for (const fix of fixes) {
    const current = fetchFullFileContent(repo, fix.path, baseBranch);
    if (current === null) return false;
    if (current !== fix.content) return false;
  }

  return true;
};

export { tmpDir };
