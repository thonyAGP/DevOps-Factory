/**
 * knowledge-graph.ts
 *
 * Cross-repo knowledge graph for validated CI fixes.
 * Indexes verified fixes by stack + pattern so self-heal.ts can
 * reuse them without calling an LLM.
 *
 * Usage:
 *   import { lookupFix, indexFix, cleanupDegradedPatterns } from './knowledge-graph.js';
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KG_PATH = new URL('../data/knowledge-graph.json', import.meta.url).pathname.replace(
  /^\/([A-Z]:)/,
  '$1'
);

export interface KnowledgeEntry {
  patternId: string;
  stack: string;
  filePaths: string[];
  diff: string; // The actual fix diff (patch content)
  repo: string; // Source repo where fix was validated
  prNumber: number;
  confidence: number; // Pattern confidence at time of indexing
  indexedAt: string;
}

interface KnowledgeGraph {
  version: number;
  lastUpdated: string;
  entries: KnowledgeEntry[];
}

const readGraph = (): KnowledgeGraph => {
  if (!existsSync(KG_PATH)) {
    return { version: 1, lastUpdated: '', entries: [] };
  }
  try {
    return JSON.parse(readFileSync(KG_PATH, 'utf-8')) as KnowledgeGraph;
  } catch {
    return { version: 1, lastUpdated: '', entries: [] };
  }
};

const writeGraph = (graph: KnowledgeGraph): void => {
  graph.lastUpdated = new Date().toISOString();
  writeFileSync(KG_PATH, JSON.stringify(graph, null, 2) + '\n');
};

/**
 * Look up a known fix for a given pattern + stack combination.
 * Returns the best matching entry (highest confidence) or undefined.
 */
export const lookupFix = (patternId: string, stack: string): KnowledgeEntry | undefined => {
  const graph = readGraph();
  const matches = graph.entries.filter((e) => e.patternId === patternId && e.stack === stack);
  if (matches.length === 0) return undefined;
  // Return highest confidence match
  return matches.sort((a, b) => b.confidence - a.confidence)[0];
};

/**
 * Index a verified fix into the knowledge graph.
 * Deduplicates by patternId + stack + repo (keeps the latest).
 */
export const indexFix = (entry: Omit<KnowledgeEntry, 'indexedAt'>): void => {
  const graph = readGraph();

  // Remove existing entry for same pattern + stack + repo
  graph.entries = graph.entries.filter(
    (e) => !(e.patternId === entry.patternId && e.stack === entry.stack && e.repo === entry.repo)
  );

  graph.entries.push({
    ...entry,
    indexedAt: new Date().toISOString(),
  });

  writeGraph(graph);
};

/**
 * Remove entries whose pattern confidence has degraded below threshold.
 */
export const cleanupDegradedPatterns = (degradedPatternIds: string[]): number => {
  if (degradedPatternIds.length === 0) return 0;
  const graph = readGraph();
  const before = graph.entries.length;
  graph.entries = graph.entries.filter((e) => !degradedPatternIds.includes(e.patternId));
  const removed = before - graph.entries.length;
  if (removed > 0) {
    writeGraph(graph);
    console.log(
      `  [KG] Cleaned ${removed} entries for degraded patterns: ${degradedPatternIds.join(', ')}`
    );
  }
  return removed;
};
