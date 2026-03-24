/**
 * schemas.ts
 *
 * Zod schemas for data/ JSON files.
 * Used to validate JSON.parse() results instead of unsafe `as Type` casts.
 */

import { z } from 'zod/v4';

export const PatternSchema = z.object({
  id: z.string(),
  category: z.string(),
  signature: z.string(),
  fix: z.string(),
  fixType: z.string(),
  repos_seen: z.array(z.string()),
  occurrences: z.number(),
  confidence: z.number(),
});

export const PatternDBSchema = z.object({
  version: z.number(),
  lastUpdated: z.string(),
  patterns: z.array(PatternSchema),
});

export const ActivityEntrySchema = z.object({
  timestamp: z.string(),
  source: z.string(),
  action: z.string(),
  target: z.string().optional(),
  details: z.string(),
  status: z.enum(['success', 'warning', 'error', 'info']),
});

export const ActivityLogSchema = z.object({
  version: z.literal(1),
  entries: z.array(ActivityEntrySchema),
});

export const CooldownSchema = z.record(z.string(), z.number());

/**
 * Safe JSON parse with Zod validation.
 * Returns the default value if parsing or validation fails.
 */
export const safeParseJSON = <T>(raw: string, schema: z.ZodType<T>, fallback: T): T => {
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
};
