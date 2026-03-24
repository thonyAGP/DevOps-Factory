import { describe, it, expect } from 'vitest';
import { renderTemplate, DEFAULT_CONFIG, type DevOpsConfig } from './template-config.js';

describe('renderTemplate', () => {
  it('should replace all placeholders with default config', () => {
    const template = `
      node-version: {{nodeVersion}}
      version: {{pnpmVersion}}
      dotnet-version: '{{dotnetVersion}}'
      threshold: {{coverageThreshold}}
      budget: {{bundleBudgetKB}}
      timeout: {{testTimeout}}
    `;

    const result = renderTemplate(template, DEFAULT_CONFIG);

    expect(result).toContain('node-version: 22');
    expect(result).toContain('version: 9');
    expect(result).toContain("dotnet-version: '8.0.x'");
    expect(result).toContain('threshold: 80');
    expect(result).toContain('budget: 500');
    expect(result).toContain('timeout: 60000');
    expect(result).not.toContain('{{');
  });

  it('should use custom config values', () => {
    const config: DevOpsConfig = {
      nodeVersion: '20',
      pnpmVersion: '8',
      dotnetVersion: '9.0.x',
      coverageThreshold: 90,
      bundleBudgetKB: 300,
      testTimeout: 30000,
    };

    const template = 'node-version: {{nodeVersion}}\nversion: {{pnpmVersion}}';
    const result = renderTemplate(template, config);

    expect(result).toContain('node-version: 20');
    expect(result).toContain('version: 8');
  });

  it('should handle multiple occurrences of same placeholder', () => {
    const template = `
      first: {{nodeVersion}}
      second: {{nodeVersion}}
      third: {{nodeVersion}}
    `;

    const result = renderTemplate(template, DEFAULT_CONFIG);
    const matches = result.match(/22/g);
    expect(matches).toHaveLength(3);
  });

  it('should leave template unchanged when no placeholders present', () => {
    const template = 'name: CI\non:\n  push:\n    branches: [main]';
    const result = renderTemplate(template, DEFAULT_CONFIG);
    expect(result).toBe(template);
  });

  it('should handle empty template', () => {
    const result = renderTemplate('', DEFAULT_CONFIG);
    expect(result).toBe('');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_CONFIG.nodeVersion).toBe('22');
    expect(DEFAULT_CONFIG.pnpmVersion).toBe('9');
    expect(DEFAULT_CONFIG.dotnetVersion).toBe('8.0.x');
    expect(DEFAULT_CONFIG.coverageThreshold).toBe(80);
    expect(DEFAULT_CONFIG.bundleBudgetKB).toBe(500);
    expect(DEFAULT_CONFIG.testTimeout).toBe(60000);
  });
});
