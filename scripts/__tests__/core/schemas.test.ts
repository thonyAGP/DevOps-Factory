import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ActivityLogSchema,
  PatternsDBSchema,
  QualityScoresSchema,
  DoraMetricsSchema,
  CooldownSchema,
  EscalationSchema,
  AlertTrackerSchema,
  CostReportSchema,
  SecurityPostureSchema,
  TemplateDriftSchema,
  StatusesSchema,
  HistorySchema,
  RecommendationsSchema,
  ComplianceReportSchema,
  ScanReportSchema,
} from '../../core/schemas.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');
const dashboardDir = resolve(import.meta.dirname, '../../../dashboard');
const dataDir = resolve(import.meta.dirname, '../../../data');

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf-8'));

const loadDashboard = (name: string): unknown => {
  const path = resolve(dashboardDir, name);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
};

const loadData = (name: string): unknown => {
  const path = resolve(dataDir, name);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
};

describe('ActivityLogSchema', () => {
  it('should validate fixture data', () => {
    const data = loadFixture('activity-log.fixture.json');
    const result = ActivityLogSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadData('activity-log.json');
    if (!data) return; // skip if no production data
    const result = ActivityLogSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject invalid version', () => {
    const result = ActivityLogSchema.safeParse({
      version: 2,
      entries: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject entry with missing status', () => {
    const result = ActivityLogSchema.safeParse({
      version: 1,
      entries: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          source: 'test',
          action: 'test',
          details: 'test',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid status value', () => {
    const result = ActivityLogSchema.safeParse({
      version: 1,
      entries: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          source: 'test',
          action: 'test',
          details: 'test',
          status: 'invalid',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should accept entry with optional target', () => {
    const result = ActivityLogSchema.safeParse({
      version: 1,
      entries: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          source: 'test',
          action: 'test',
          target: 'my-target',
          details: 'test',
          status: 'success',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('PatternsDBSchema', () => {
  it('should validate fixture data', () => {
    const data = loadFixture('patterns.fixture.json');
    const result = PatternsDBSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadData('patterns.json');
    if (!data) return;
    const result = PatternsDBSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject pattern with confidence > 1', () => {
    const result = PatternsDBSchema.safeParse({
      version: 1,
      lastUpdated: '2026-01-01',
      patterns: [
        {
          id: 'test',
          category: 'ci-failure',
          signature: 'test',
          fix: 'fix',
          fixType: 'command',
          repos_seen: [],
          occurrences: 0,
          confidence: 1.5,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative occurrences', () => {
    const result = PatternsDBSchema.safeParse({
      version: 1,
      lastUpdated: '2026-01-01',
      patterns: [
        {
          id: 'test',
          category: 'ci-failure',
          signature: 'test',
          fix: 'fix',
          fixType: 'command',
          repos_seen: [],
          occurrences: -1,
          confidence: 0.5,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('QualityScoresSchema', () => {
  it('should validate fixture data', () => {
    const data = loadFixture('quality-scores.fixture.json');
    const result = QualityScoresSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadDashboard('quality-scores.json');
    if (!data) return;
    const result = QualityScoresSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject score > 100', () => {
    const result = QualityScoresSchema.safeParse({
      timestamp: '2026-01-01',
      scores: [
        {
          name: 'test',
          repo: 'test/test',
          score: 150,
          breakdown: {
            ciPasses: 20,
            coverageAboveThreshold: 20,
            prettierClean: 10,
            eslintZeroWarnings: 15,
            branchProtection: 10,
            depsUpToDate: 10,
            noSecrets: 15,
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('DoraMetricsSchema', () => {
  it('should validate fixture data', () => {
    const data = loadFixture('dora-metrics.fixture.json');
    const result = DoraMetricsSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadDashboard('dora-metrics.json');
    if (!data) return;
    const result = DoraMetricsSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject invalid rating', () => {
    const result = DoraMetricsSchema.safeParse({
      timestamp: '2026-01-01',
      repos: [
        {
          repo: 'test',
          fullName: 'test/test',
          deploymentFrequency: 0,
          leadTimeHours: 0,
          mttrHours: 0,
          changeFailureRate: 0,
          rating: 'invalid',
          prsMerged30d: 0,
          releases30d: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('CooldownSchema', () => {
  it('should validate fixture data', () => {
    const data = loadFixture('cooldowns.fixture.json');
    const result = CooldownSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadData('self-heal-cooldowns.json');
    if (!data) return;
    const result = CooldownSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept empty object', () => {
    const result = CooldownSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('EscalationSchema', () => {
  it('should validate fixture data', () => {
    const data = loadFixture('escalation.fixture.json');
    const result = EscalationSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadData('escalation-tracker.json');
    if (!data) return;
    const result = EscalationSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject missing escalated field', () => {
    const result = EscalationSchema.safeParse({
      'test/repo': {
        consecutiveFailures: 1,
        lastFailure: '2026-01-01',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('AlertTrackerSchema', () => {
  it('should validate empty array', () => {
    const result = AlertTrackerSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('should validate production data', () => {
    const data = loadData('alert-tracker.json');
    if (!data) return;
    const result = AlertTrackerSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('CostReportSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('cost-report.json');
    if (!data) return;
    const result = CostReportSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('SecurityPostureSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('security-posture.json');
    if (!data) return;
    const result = SecurityPostureSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('TemplateDriftSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('template-drift.json');
    if (!data) return;
    const result = TemplateDriftSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject invalid drift status', () => {
    const result = TemplateDriftSchema.safeParse({
      timestamp: '2026-01-01',
      repos: [
        {
          repo: 'test',
          fullName: 'test/test',
          templates: [
            {
              template: 'ci.yml',
              repoPath: '.github/workflows/ci.yml',
              status: 'invalid-status',
              similarity: 0,
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('StatusesSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('statuses.json');
    if (!data) return;
    const result = StatusesSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('HistorySchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('history.json');
    if (!data) return;
    const result = HistorySchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept empty array', () => {
    const result = HistorySchema.safeParse([]);
    expect(result.success).toBe(true);
  });
});

describe('RecommendationsSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('recommendations.json');
    if (!data) return;
    const result = RecommendationsSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('ComplianceReportSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('compliance-report.json');
    if (!data) return;
    const result = ComplianceReportSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('ScanReportSchema', () => {
  it('should validate production data', () => {
    const data = loadDashboard('scan-report.json');
    if (!data) return;
    const result = ScanReportSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});
