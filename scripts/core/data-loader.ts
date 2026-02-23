import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod/v4';

export class DataLoadError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DataLoadError';
  }
}

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly issues: unknown[]
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

const ensureDir = (filePath: string): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

export const loadJSON = <T>(path: string, schema: z.ZodType<T>): T => {
  if (!existsSync(path)) {
    throw new DataLoadError(`File not found: ${path}`, path);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new DataLoadError(`Failed to read file: ${path}`, path, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DataLoadError(`Invalid JSON in file: ${path}`, path, err);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new SchemaValidationError(
      `Schema validation failed for: ${path}`,
      path,
      result.error.issues
    );
  }

  return result.data;
};

export const loadJSONSafe = <T>(path: string, schema: z.ZodType<T>, fallback: T): T => {
  try {
    return loadJSON(path, schema);
  } catch {
    return fallback;
  }
};

export const saveJSON = <T>(path: string, data: T, schema: z.ZodType<T>): void => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SchemaValidationError(
      `Data validation failed before saving: ${path}`,
      path,
      result.error.issues
    );
  }

  ensureDir(path);
  writeFileSync(path, JSON.stringify(result.data, null, 2) + '\n');
};

export const loadRawJSON = <T>(path: string): T => {
  if (!existsSync(path)) {
    throw new DataLoadError(`File not found: ${path}`, path);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new DataLoadError(`Failed to read file: ${path}`, path, err);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new DataLoadError(`Invalid JSON in file: ${path}`, path, err);
  }
};
