import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appendToLog, readLogEntries, withFileLock, safeWriteJSON } from '../../core/git-utils.js';

const testDir = resolve(import.meta.dirname, '../../../.test-tmp-git');

beforeEach(() => {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('appendToLog', () => {
  it('should append JSON line to file', () => {
    const filePath = resolve(testDir, 'log.jsonl');
    appendToLog(filePath, { action: 'test', timestamp: '2026-01-01' });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{"action":"test","timestamp":"2026-01-01"}\n');
  });

  it('should append multiple entries', () => {
    const filePath = resolve(testDir, 'multi.jsonl');
    appendToLog(filePath, { id: 1 });
    appendToLog(filePath, { id: 2 });
    appendToLog(filePath, { id: 3 });

    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('should create parent directories', () => {
    const filePath = resolve(testDir, 'nested', 'deep', 'log.jsonl');
    appendToLog(filePath, { data: true });
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('readLogEntries', () => {
  it('should read JSON Lines file', () => {
    const filePath = resolve(testDir, 'read.jsonl');
    writeFileSync(filePath, '{"id":1}\n{"id":2}\n{"id":3}\n');

    const entries = readLogEntries(filePath);
    expect(entries).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('should return empty array for missing file', () => {
    const entries = readLogEntries(resolve(testDir, 'nope.jsonl'));
    expect(entries).toEqual([]);
  });

  it('should skip invalid JSON lines', () => {
    const filePath = resolve(testDir, 'mixed.jsonl');
    writeFileSync(filePath, '{"id":1}\nnot json\n{"id":2}\n');

    const entries = readLogEntries(filePath);
    expect(entries).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should handle empty file', () => {
    const filePath = resolve(testDir, 'empty.jsonl');
    writeFileSync(filePath, '');

    const entries = readLogEntries(filePath);
    expect(entries).toEqual([]);
  });
});

describe('withFileLock', () => {
  it('should execute function and return result', () => {
    const filePath = resolve(testDir, 'locktest.json');
    writeFileSync(filePath, '{}');

    const result = withFileLock(filePath, () => 42);
    expect(result).toBe(42);
  });

  it('should clean up lock file after execution', () => {
    const filePath = resolve(testDir, 'lockclean.json');
    writeFileSync(filePath, '{}');

    withFileLock(filePath, () => 'done');
    expect(existsSync(`${filePath}.lock`)).toBe(false);
  });

  it('should clean up lock file on error', () => {
    const filePath = resolve(testDir, 'lockerr.json');
    writeFileSync(filePath, '{}');

    expect(() =>
      withFileLock(filePath, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');

    expect(existsSync(`${filePath}.lock`)).toBe(false);
  });
});

describe('safeWriteJSON', () => {
  it('should write JSON with lock', () => {
    const filePath = resolve(testDir, 'safe.json');
    safeWriteJSON(filePath, { key: 'value' });

    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual({ key: 'value' });
  });

  it('should create parent directories', () => {
    const filePath = resolve(testDir, 'deep', 'nested', 'safe.json');
    safeWriteJSON(filePath, { nested: true });
    expect(existsSync(filePath)).toBe(true);
  });
});
