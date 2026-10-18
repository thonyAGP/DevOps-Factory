import { describe, expect, it } from 'vitest';
import { generateDailyReport } from './report.js';

describe('daily report inventory guard', () => {
  it('rejects zero monitored projects instead of publishing NaN and zero failures', () => {
    expect(() => generateDailyReport([])).toThrow('No monitored projects');
  });
});
