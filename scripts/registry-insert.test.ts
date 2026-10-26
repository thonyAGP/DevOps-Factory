import { describe, expect, it } from 'vitest';
import { findKnownProjectsInsertPos } from './registry-insert.js';

const SAMPLE = [
  'export const KNOWN_PROJECTS: ProjectConfig[] = [',
  "  { name: 'a' },",
  '];',
  '',
  'export const PRIVATE_WORKFLOW_ALLOWLIST: readonly string[] = [',
  "  'ci.yml',",
  '];',
  '',
  "export const GITHUB_OWNER = 'x';",
].join('\n');

describe('findKnownProjectsInsertPos', () => {
  it('points at the closing bracket of KNOWN_PROJECTS, not the array before GITHUB_OWNER', () => {
    const pos = findKnownProjectsInsertPos(SAMPLE);
    expect(SAMPLE.slice(pos, pos + 2)).toBe('];');
    expect(pos).toBeLessThan(SAMPLE.indexOf('PRIVATE_WORKFLOW_ALLOWLIST'));
  });

  it('returns -1 when KNOWN_PROJECTS is missing', () => {
    expect(findKnownProjectsInsertPos('export const X = [\n];')).toBe(-1);
  });
});
