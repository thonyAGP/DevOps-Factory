import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod/v4';
import {
  loadJSON,
  loadJSONSafe,
  saveJSON,
  loadRawJSON,
  DataLoadError,
  SchemaValidationError,
} from '../../core/data-loader.js';

const testDir = resolve(import.meta.dirname, '../../../.test-tmp');

const TestSchema = z.object({
  name: z.string(),
  value: z.number(),
});

beforeEach(() => {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('loadJSON', () => {
  it('should load and validate valid JSON', () => {
    const filePath = resolve(testDir, 'valid.json');
    writeFileSync(filePath, JSON.stringify({ name: 'test', value: 42 }));

    const result = loadJSON(filePath, TestSchema);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('should throw DataLoadError for missing file', () => {
    expect(() => loadJSON(resolve(testDir, 'missing.json'), TestSchema)).toThrow(DataLoadError);
  });

  it('should throw DataLoadError for invalid JSON', () => {
    const filePath = resolve(testDir, 'invalid.json');
    writeFileSync(filePath, 'not json {{{');

    expect(() => loadJSON(filePath, TestSchema)).toThrow(DataLoadError);
  });

  it('should throw SchemaValidationError for wrong schema', () => {
    const filePath = resolve(testDir, 'wrong-schema.json');
    writeFileSync(filePath, JSON.stringify({ name: 'test', value: 'not-a-number' }));

    expect(() => loadJSON(filePath, TestSchema)).toThrow(SchemaValidationError);
  });

  it('should include path in DataLoadError', () => {
    const filePath = resolve(testDir, 'missing.json');
    try {
      loadJSON(filePath, TestSchema);
    } catch (err) {
      expect((err as DataLoadError).path).toBe(filePath);
    }
  });

  it('should include issues in SchemaValidationError', () => {
    const filePath = resolve(testDir, 'wrong.json');
    writeFileSync(filePath, JSON.stringify({ name: 123, value: 'bad' }));

    try {
      loadJSON(filePath, TestSchema);
    } catch (err) {
      expect((err as SchemaValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe('loadJSONSafe', () => {
  it('should return data for valid file', () => {
    const filePath = resolve(testDir, 'valid.json');
    writeFileSync(filePath, JSON.stringify({ name: 'ok', value: 1 }));

    const result = loadJSONSafe(filePath, TestSchema, { name: 'fallback', value: 0 });
    expect(result).toEqual({ name: 'ok', value: 1 });
  });

  it('should return fallback for missing file', () => {
    const result = loadJSONSafe(resolve(testDir, 'nope.json'), TestSchema, {
      name: 'fallback',
      value: 0,
    });
    expect(result).toEqual({ name: 'fallback', value: 0 });
  });

  it('should return fallback for invalid JSON', () => {
    const filePath = resolve(testDir, 'bad.json');
    writeFileSync(filePath, '{{{{');

    const result = loadJSONSafe(filePath, TestSchema, { name: 'fallback', value: 0 });
    expect(result).toEqual({ name: 'fallback', value: 0 });
  });

  it('should return fallback for schema mismatch', () => {
    const filePath = resolve(testDir, 'mismatch.json');
    writeFileSync(filePath, JSON.stringify({ wrong: 'shape' }));

    const result = loadJSONSafe(filePath, TestSchema, { name: 'fallback', value: 0 });
    expect(result).toEqual({ name: 'fallback', value: 0 });
  });
});

describe('saveJSON', () => {
  it('should save valid data', () => {
    const filePath = resolve(testDir, 'output.json');
    saveJSON(filePath, { name: 'saved', value: 99 }, TestSchema);

    const raw = readFileSync(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ name: 'saved', value: 99 });
  });

  it('should create parent directories', () => {
    const filePath = resolve(testDir, 'nested', 'deep', 'output.json');
    saveJSON(filePath, { name: 'deep', value: 1 }, TestSchema);

    expect(existsSync(filePath)).toBe(true);
  });

  it('should throw SchemaValidationError for invalid data', () => {
    const filePath = resolve(testDir, 'bad-save.json');
    expect(() =>
      saveJSON(
        filePath,
        { name: 123, value: 'bad' } as unknown as z.infer<typeof TestSchema>,
        TestSchema
      )
    ).toThrow(SchemaValidationError);
  });

  it('should not create file on validation failure', () => {
    const filePath = resolve(testDir, 'no-file.json');
    try {
      saveJSON(filePath, { wrong: true } as unknown as z.infer<typeof TestSchema>, TestSchema);
    } catch {
      // expected
    }
    expect(existsSync(filePath)).toBe(false);
  });
});

describe('loadRawJSON', () => {
  it('should load JSON without schema validation', () => {
    const filePath = resolve(testDir, 'raw.json');
    writeFileSync(filePath, JSON.stringify({ any: 'shape', works: true }));

    const result = loadRawJSON<{ any: string; works: boolean }>(filePath);
    expect(result).toEqual({ any: 'shape', works: true });
  });

  it('should throw DataLoadError for missing file', () => {
    expect(() => loadRawJSON(resolve(testDir, 'nope.json'))).toThrow(DataLoadError);
  });

  it('should throw DataLoadError for invalid JSON', () => {
    const filePath = resolve(testDir, 'bad-raw.json');
    writeFileSync(filePath, 'not json');
    expect(() => loadRawJSON(filePath)).toThrow(DataLoadError);
  });
});
