import { describe, expect, it } from 'vitest';
import { CLAUDE_REVIEW_CONFIG, REMEDIATION_CONFIG, KNOWN_PROJECTS } from './factory.config.js';
import { isPriorityRepository, retainPriorityOptIns, SUPPORT_REPOSITORIES } from './portfolio-policy.js';

describe('owner portfolio priorities', () => {
  it('narrows existing opt-ins without enabling new agents on priority projects', () => {
    expect(retainPriorityOptIns(['thonyAGP/CasaSync', 'thonyAGP/ClubMedRoomAssignment', 'thonyAGP/LecteurMagic']))
      .toEqual(['thonyAGP/CasaSync']);
    expect(CLAUDE_REVIEW_CONFIG.enabledRepos).toEqual(['thonyAGP/CasaSync']);
    expect(REMEDIATION_CONFIG.enabled).toBe(false);
    expect(REMEDIATION_CONFIG.enabledRepos).toEqual([]);
  });
  it('preserves Larbin dependencies without making them development targets', () => {
    expect(SUPPORT_REPOSITORIES).toContain('thonyAGP/Boxmail_cleaning');
    expect(isPriorityRepository('thonyAGP/Boxmail_cleaning')).toBe(false);
    expect(isPriorityRepository('thonyAGP/CarAssist')).toBe(true);
    expect(isPriorityRepository('other/CasaSync')).toBe(false);
  });
  it('keeps non-priority projects in the monitoring inventory', () => {
    expect(KNOWN_PROJECTS.some(p => p.repo === 'thonyAGP/au-marais')).toBe(true);
    expect(KNOWN_PROJECTS.some(p => p.repo === 'thonyAGP/livret-au-marais')).toBe(true);
    expect(KNOWN_PROJECTS.some(p => p.repo === 'thonyAGP/Thumbfast')).toBe(true);
  });
});
