import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FailedJob, CooldownEntry } from './types.js';
import type { Pattern, PatternDB } from '../types.js';

// Mock constants before importing modules
vi.mock('./constants.js', () => ({
  PATTERN_DB_PATH: '/tmp/test-patterns.json',
  COOLDOWN_DB_PATH: '/tmp/test-cooldown.json',
  PATTERN_CONFIDENCE_THRESHOLD: 0.8,
  COOLDOWN_HOURS: 24,
  MAX_ATTEMPTS_BEFORE_ESCALATION: 2,
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_URL: 'https://api.example.com',
  AI_PROVIDERS: [],
  MAX_LOG_LINES: 400,
  MAX_FILE_SIZE: 50000,
  MAX_OPEN_HEALING_PRS: 3,
  DEDUP_WINDOW_HOURS: 72,
  AUTO_MERGE_CONFIDENCE_THRESHOLD: 0.85,
  AUTO_MERGE_GRADUATED_THRESHOLD: 0.7,
  STYLECOP_AUTO_FIX: [],
}));

// Mock fs module — vi.hoisted runs before vi.mock hoisting
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:fs', () => mockFs);

// Import modules after mocking
import * as patternDb from './pattern-db.js';
import * as cooldown from './cooldown.js';

describe('pattern-db.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
  });

  describe('loadPatterns', () => {
    it('should return empty DB when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = patternDb.loadPatterns();

      expect(result).toEqual({
        version: 1,
        lastUpdated: '',
        patterns: [],
      });
      expect(mockFs.existsSync).toHaveBeenCalledWith('/tmp/test-patterns.json');
    });

    it('should return empty DB when file contains invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json {]');

      const result = patternDb.loadPatterns();

      expect(result).toEqual({
        version: 1,
        lastUpdated: '',
        patterns: [],
      });
    });

    it('should return empty DB when parsed data has invalid structure', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ patterns: 'not-an-array' }));

      const result = patternDb.loadPatterns();

      expect(result).toEqual({
        version: 1,
        lastUpdated: '',
        patterns: [],
      });
    });

    it('should return parsed patterns when file is valid', () => {
      const mockPatterns: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [
          {
            id: 'pattern-1',
            category: 'ci-failure',
            signature: 'connection timeout',
            fix: 'retry with exponential backoff',
            fixType: '',
            repos_seen: ['repo-a'],
            occurrences: 5,
            confidence: 0.85,
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      const result = patternDb.loadPatterns();

      expect(result).toEqual(mockPatterns);
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].confidence).toBe(0.85);
    });

    it('should handle multiple patterns correctly', () => {
      const mockPatterns: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [
          {
            id: 'pattern-1',
            category: 'ci-failure',
            signature: 'connection timeout',
            fix: 'retry',
            fixType: '',
            repos_seen: ['repo-a'],
            occurrences: 5,
            confidence: 0.85,
          },
          {
            id: 'pattern-2',
            category: 'ci-failure',
            signature: 'out of memory',
            fix: 'increase heap',
            fixType: '',
            repos_seen: ['repo-b'],
            occurrences: 3,
            confidence: 0.75,
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      const result = patternDb.loadPatterns();

      expect(result.patterns).toHaveLength(2);
    });
  });

  describe('matchPattern', () => {
    const mockPattern: Pattern = {
      id: 'pattern-1',
      category: 'ci-failure',
      signature: 'connection timeout',
      fix: 'retry with exponential backoff',
      fixType: '',
      repos_seen: ['repo-a'],
      occurrences: 5,
      confidence: 0.85,
    };

    const mockLowConfidencePattern: Pattern = {
      ...mockPattern,
      id: 'pattern-low',
      confidence: 0.7,
    };

    it('should return null when no patterns match', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job',
          annotations: [
            {
              path: '.github/workflows/test.yml',
              start_line: 10,
              end_line: 15,
              annotation_level: 'failure',
              message: 'some other error',
            },
          ],
          logs: 'other log content',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      expect(result).toBeNull();
    });

    it('should return matching pattern when annotation message matches signature', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job',
          annotations: [
            {
              path: '.github/workflows/test.yml',
              start_line: 10,
              end_line: 15,
              annotation_level: 'failure',
              message: 'Error: connection timeout occurred',
            },
          ],
          logs: '',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      expect(result).toEqual(mockPattern);
    });

    it('should return matching pattern when logs contain signature', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job',
          annotations: [],
          logs: 'Build failed due to: connection timeout\nStack trace...',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      expect(result).toEqual(mockPattern);
    });

    it('should skip patterns with confidence below threshold', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockLowConfidencePattern, mockPattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job',
          annotations: [
            {
              path: '.github/workflows/test.yml',
              start_line: 10,
              end_line: 15,
              annotation_level: 'failure',
              message: 'Error: connection timeout occurred',
            },
          ],
          logs: '',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      // Should match the high-confidence pattern, not the low-confidence one
      expect(result).toEqual(mockPattern);
    });

    it('should return null if only low-confidence patterns match', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockLowConfidencePattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job',
          annotations: [
            {
              path: '.github/workflows/test.yml',
              start_line: 10,
              end_line: 15,
              annotation_level: 'failure',
              message: 'Error: connection timeout occurred',
            },
          ],
          logs: '',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      expect(result).toBeNull();
    });

    it('should check annotations message field', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job',
          annotations: [
            {
              path: '.github/workflows/test.yml',
              start_line: 10,
              end_line: 15,
              annotation_level: 'failure',
              message: 'connection timeout in request handler',
            },
          ],
          logs: '',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      expect(result).toEqual(mockPattern);
    });

    it('should handle multiple jobs', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const jobs: FailedJob[] = [
        {
          id: 1,
          name: 'test-job-1',
          annotations: [
            {
              path: '.github/workflows/test.yml',
              start_line: 10,
              end_line: 15,
              annotation_level: 'failure',
              message: 'some error',
            },
          ],
          logs: '',
        },
        {
          id: 2,
          name: 'test-job-2',
          annotations: [],
          logs: 'connection timeout in retry loop',
        },
      ];

      const result = patternDb.matchPattern(jobs);

      expect(result).toEqual(mockPattern);
    });
  });

  describe('matchedPatternConfidence', () => {
    const mockPattern: Pattern = {
      id: 'pattern-1',
      category: 'ci-failure',
      signature: 'connection timeout',
      fix: 'retry with exponential backoff',
      fixType: '',
      repos_seen: ['repo-a'],
      occurrences: 5,
      confidence: 0.85,
    };

    it('should return 0 when pattern not found', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const confidence = patternDb.matchedPatternConfidence('unknown-pattern');

      expect(confidence).toBe(0);
    });

    it('should return pattern confidence when found', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [mockPattern],
        })
      );

      const confidence = patternDb.matchedPatternConfidence('pattern-1');

      expect(confidence).toBe(0.85);
    });

    it('should find correct pattern from multiple patterns', () => {
      const patterns: Pattern[] = [
        { ...mockPattern, id: 'pattern-1', confidence: 0.85 },
        { ...mockPattern, id: 'pattern-2', confidence: 0.65 },
        { ...mockPattern, id: 'pattern-3', confidence: 0.95 },
      ];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns,
        })
      );

      expect(patternDb.matchedPatternConfidence('pattern-1')).toBe(0.85);
      expect(patternDb.matchedPatternConfidence('pattern-2')).toBe(0.65);
      expect(patternDb.matchedPatternConfidence('pattern-3')).toBe(0.95);
    });
  });

  describe('recordPatternHit', () => {
    const mockPattern: Pattern = {
      id: 'pattern-1',
      category: 'ci-failure',
      signature: 'connection timeout',
      fix: 'retry with exponential backoff',
      fixType: '',
      repos_seen: ['repo-a'],
      occurrences: 5,
      confidence: 0.85,
    };

    it('should increment occurrences on successful hit', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].occurrences).toBe(6);
    });

    it('should increase confidence on success', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern, confidence: 0.8 }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].confidence).toBeCloseTo(0.85);
    });

    it('should cap confidence at 1.0', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern, confidence: 0.96 }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].confidence).toBe(1);
    });

    it('should decrease confidence on failure', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern, confidence: 0.85 }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].confidence).toBe(0.75);
    });

    it('should floor confidence at 0.0', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern, confidence: 0.05 }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].confidence).toBe(0);
    });

    it('should add new repo to repos_seen', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern, repos_seen: ['repo-a'] }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-b', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].repos_seen).toContain('repo-a');
      expect(writtenData.patterns[0].repos_seen).toContain('repo-b');
    });

    it('should not duplicate repo in repos_seen', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [{ ...mockPattern, repos_seen: ['repo-a'] }],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns[0].repos_seen).toEqual(['repo-a']);
    });

    it('should update lastUpdated timestamp', () => {
      const db: PatternDB = {
        version: 1,
        lastUpdated: '2025-01-01T00:00:00Z',
        patterns: [mockPattern],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(db));

      patternDb.recordPatternHit('pattern-1', 'repo-a', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.lastUpdated).not.toBe('2025-01-01T00:00:00Z');
    });
  });

  describe('addNewPattern', () => {
    it('should not add pattern with generic exit code signature', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [],
        })
      );

      const result = patternDb.addNewPattern(
        'Process completed with exit code 1',
        'retry',
        'repo-a'
      );

      expect(result).toBe('');
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should not add pattern with signature too short', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [],
        })
      );

      const result = patternDb.addNewPattern('short', 'fix', 'repo-a');

      expect(result).toBe('');
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should add valid new pattern', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [],
        })
      );

      vi.useFakeTimers();
      const now = new Date('2025-01-15T10:30:00Z');
      vi.setSystemTime(now);

      const result = patternDb.addNewPattern(
        'This is a long enough signature message',
        'apply this fix',
        'repo-a'
      );

      expect(result).toMatch(/^auto-/);
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.patterns).toHaveLength(1);
      expect(writtenData.patterns[0].signature).toBe('This is a long enough signature message');
      expect(writtenData.patterns[0].fix).toBe('apply this fix');
      expect(writtenData.patterns[0].repos_seen).toEqual(['repo-a']);
      expect(writtenData.patterns[0].occurrences).toBe(1);
      expect(writtenData.patterns[0].confidence).toBe(0.5);
      expect(writtenData.patterns[0].fixType).toBe('');

      vi.useRealTimers();
    });

    it('should generate unique IDs with timestamp', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [],
        })
      );

      vi.useFakeTimers();
      const now1 = new Date('2025-01-15T10:30:00Z');
      vi.setSystemTime(now1);

      const id1 = patternDb.addNewPattern('First pattern signature message', 'fix 1', 'repo-a');

      const now2 = new Date('2025-01-15T10:30:05Z');
      vi.setSystemTime(now2);

      mockFs.writeFileSync.mockClear();
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          lastUpdated: '',
          patterns: [
            {
              id: id1,
              category: 'ci-failure',
              signature: 'First pattern signature message',
              fix: 'fix 1',
              fixType: '',
              repos_seen: ['repo-a'],
              occurrences: 1,
              confidence: 0.5,
            },
          ],
        })
      );

      const id2 = patternDb.addNewPattern('Second pattern signature message', 'fix 2', 'repo-b');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^auto-\d+$/);
      expect(id2).toMatch(/^auto-\d+$/);

      vi.useRealTimers();
    });
  });
});

describe('cooldown.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkCooldown', () => {
    it('should return proceed when no cooldown entry exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([]));

      const result = cooldown.checkCooldown('repo-a', 'error signature');

      expect(result).toBe('proceed');
    });

    it('should return skip when within cooldown window', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 1,
        lastAttempt: oneHourAgo.toISOString(),
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = cooldown.checkCooldown('repo-a', 'connection timeout');

      expect(result).toBe('skip');

      vi.useRealTimers();
    });

    it('should return escalate when max attempts reached and outside cooldown', () => {
      const now = new Date();
      // Must be > COOLDOWN_HOURS (24h) to be outside cooldown window
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 3,
        lastAttempt: thirtyHoursAgo.toISOString(),
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = cooldown.checkCooldown('repo-a', 'connection timeout');

      expect(result).toBe('escalate');

      vi.useRealTimers();
    });

    it('should return proceed when outside cooldown and attempts below max', () => {
      const now = new Date();
      // Must be > COOLDOWN_HOURS (24h) to be outside cooldown window
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 1,
        lastAttempt: thirtyHoursAgo.toISOString(),
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = cooldown.checkCooldown('repo-a', 'connection timeout');

      expect(result).toBe('proceed');

      vi.useRealTimers();
    });

    it('should not match different error signatures', () => {
      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 1,
        lastAttempt: new Date().toISOString(),
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      const result = cooldown.checkCooldown('repo-a', 'different error');

      expect(result).toBe('proceed');
    });

    it('should not match different repos', () => {
      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 1,
        lastAttempt: new Date().toISOString(),
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      const result = cooldown.checkCooldown('repo-b', 'connection timeout');

      expect(result).toBe('proceed');
    });

    it('should clean old cooldowns before checking', () => {
      const now = new Date();
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

      const oldEntry: CooldownEntry = {
        repo: 'repo-old',
        errorSignature: 'old error',
        attempts: 1,
        lastAttempt: eightDaysAgo.toISOString(),
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([oldEntry]));

      vi.useFakeTimers();
      vi.setSystemTime(now);

      cooldown.checkCooldown('repo-new', 'new error');

      // Verify cleanup was called (old entry should be removed)
      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData).toEqual([]);

      vi.useRealTimers();
    });
  });

  describe('recordAttempt', () => {
    it('should create new entry when none exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([]));

      vi.useFakeTimers();
      const now = new Date('2025-01-15T10:30:00Z');
      vi.setSystemTime(now);

      cooldown.recordAttempt('repo-a', 'error signature', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].repo).toBe('repo-a');
      expect(writtenData[0].errorSignature).toBe('error signature');
      expect(writtenData[0].attempts).toBe(1);
      expect(writtenData[0].status).toBe('pending');
      expect(writtenData[0].lastAttempt).toBe(now.toISOString());

      vi.useRealTimers();
    });

    it('should increment attempts on existing entry', () => {
      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 2,
        lastAttempt: '2025-01-15T09:00:00Z',
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      vi.useFakeTimers();
      const now = new Date('2025-01-15T10:30:00Z');
      vi.setSystemTime(now);

      cooldown.recordAttempt('repo-a', 'connection timeout', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData[0].attempts).toBe(3);
      expect(writtenData[0].lastAttempt).toBe(now.toISOString());

      vi.useRealTimers();
    });

    it('should set status to fixed on success', () => {
      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 1,
        lastAttempt: '2025-01-15T09:00:00Z',
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      cooldown.recordAttempt('repo-a', 'connection timeout', true);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData[0].status).toBe('fixed');
    });

    it('should keep status pending on failure', () => {
      const entry: CooldownEntry = {
        repo: 'repo-a',
        errorSignature: 'connection timeout',
        attempts: 1,
        lastAttempt: '2025-01-15T09:00:00Z',
        status: 'pending',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([entry]));

      cooldown.recordAttempt('repo-a', 'connection timeout', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData[0].status).toBe('pending');
    });

    it('should preserve other entries when updating one', () => {
      const entries: CooldownEntry[] = [
        {
          repo: 'repo-a',
          errorSignature: 'error1',
          attempts: 1,
          lastAttempt: '2025-01-15T09:00:00Z',
          status: 'pending',
        },
        {
          repo: 'repo-b',
          errorSignature: 'error2',
          attempts: 2,
          lastAttempt: '2025-01-15T08:00:00Z',
          status: 'pending',
        },
      ];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(entries));

      cooldown.recordAttempt('repo-a', 'error1', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData).toHaveLength(2);
      expect(writtenData[0].attempts).toBe(2);
      expect(writtenData[1].attempts).toBe(2);
    });

    it('should handle missing file on record', () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.useFakeTimers();
      const now = new Date('2025-01-15T10:30:00Z');
      vi.setSystemTime(now);

      cooldown.recordAttempt('repo-a', 'error signature', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].repo).toBe('repo-a');

      vi.useRealTimers();
    });

    it('should handle multiple different entries', () => {
      const entries: CooldownEntry[] = [
        {
          repo: 'repo-a',
          errorSignature: 'error1',
          attempts: 1,
          lastAttempt: '2025-01-15T09:00:00Z',
          status: 'pending',
        },
      ];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(entries));

      vi.useFakeTimers();
      const now = new Date('2025-01-15T10:30:00Z');
      vi.setSystemTime(now);

      cooldown.recordAttempt('repo-b', 'error2', false);

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData).toHaveLength(2);
      expect(writtenData[0].repo).toBe('repo-a');
      expect(writtenData[1].repo).toBe('repo-b');

      vi.useRealTimers();
    });
  });

  describe('cleanOldCooldowns', () => {
    it('should remove entries older than 7 days', () => {
      const now = new Date();
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const entries: CooldownEntry[] = [
        {
          repo: 'repo-old',
          errorSignature: 'old error',
          attempts: 1,
          lastAttempt: eightDaysAgo.toISOString(),
          status: 'pending',
        },
        {
          repo: 'repo-new',
          errorSignature: 'new error',
          attempts: 1,
          lastAttempt: twoDaysAgo.toISOString(),
          status: 'pending',
        },
      ];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(entries));

      vi.useFakeTimers();
      vi.setSystemTime(now);

      cooldown.cleanOldCooldowns();

      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);

      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].repo).toBe('repo-new');

      vi.useRealTimers();
    });

    it('should not write if no cleanup needed', () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const entries: CooldownEntry[] = [
        {
          repo: 'repo-a',
          errorSignature: 'error',
          attempts: 1,
          lastAttempt: twoDaysAgo.toISOString(),
          status: 'pending',
        },
      ];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(entries));

      vi.useFakeTimers();
      vi.setSystemTime(now);

      cooldown.cleanOldCooldowns();

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
