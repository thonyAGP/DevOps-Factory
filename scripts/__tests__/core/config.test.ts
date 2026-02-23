import {
  KNOWN_PROJECTS,
  GITHUB_OWNER,
  DASHBOARD_URL,
  ESCALATION_THRESHOLD,
  COOLDOWN_HOURS,
  AI_QUOTAS,
  DATA_PATHS,
  DASHBOARD_PATHS,
  RETENTION_DAYS,
  QUALITY_WEIGHTS,
} from '../../core/config.js';

describe('config', () => {
  it('should export KNOWN_PROJECTS as non-empty array', () => {
    expect(Array.isArray(KNOWN_PROJECTS)).toBe(true);
    expect(KNOWN_PROJECTS.length).toBeGreaterThan(0);
  });

  it('should have valid project entries', () => {
    for (const project of KNOWN_PROJECTS) {
      expect(project.name).toBeTruthy();
      expect(project.repo).toMatch(/^thonyAGP\//);
      expect(typeof project.hasCI).toBe('boolean');
      expect(['nextjs', 'fastify', 'astro', 'dotnet', 'node', 'unknown']).toContain(project.stack);
    }
  });

  it('should export GITHUB_OWNER', () => {
    expect(GITHUB_OWNER).toBe('thonyAGP');
  });

  it('should export valid DASHBOARD_URL', () => {
    expect(DASHBOARD_URL).toMatch(/^https:\/\//);
  });

  it('should export numeric thresholds', () => {
    expect(ESCALATION_THRESHOLD).toBeGreaterThan(0);
    expect(COOLDOWN_HOURS.default).toBeGreaterThan(0);
    expect(COOLDOWN_HOURS.escalated).toBeGreaterThan(COOLDOWN_HOURS.default);
    expect(COOLDOWN_HOURS.critical).toBeGreaterThan(COOLDOWN_HOURS.escalated);
  });

  it('should export AI quotas', () => {
    expect(AI_QUOTAS.testWriterPerDay).toBeGreaterThan(0);
    expect(AI_QUOTAS.reviewPerDay).toBeGreaterThan(0);
  });

  it('should export data paths', () => {
    expect(DATA_PATHS.activityLog).toMatch(/\.json$/);
    expect(DATA_PATHS.patterns).toMatch(/\.json$/);
    expect(DATA_PATHS.cooldowns).toMatch(/\.json$/);
  });

  it('should export dashboard paths', () => {
    expect(DASHBOARD_PATHS.index).toMatch(/\.html$/);
    expect(DASHBOARD_PATHS.scanReport).toMatch(/\.json$/);
    expect(DASHBOARD_PATHS.qualityScores).toMatch(/\.json$/);
  });

  it('should have reasonable retention', () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  it('should have quality weights summing to 100', () => {
    const total = Object.values(QUALITY_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });
});
