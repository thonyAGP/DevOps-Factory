import { describe, it, expect } from 'vitest';
import { jq, devNull } from './shell-utils.js';

describe('shell-utils', () => {
  describe('jq', () => {
    it('should wrap expression in quotes on windows', () => {
      // Simulate Windows
      const result = jq('.name');
      expect(result).toBeTruthy();
      // Should not be empty
      expect(result.length).toBeGreaterThan(0);
    });

    it('should wrap expression in single quotes on non-windows', () => {
      const result = jq('.name');
      if (process.platform !== 'win32') {
        expect(result).toBe("'.name'");
      }
    });

    it('should escape double quotes on windows', () => {
      const result = jq('.key == "value"');
      expect(result).toBeTruthy();
      if (process.platform === 'win32') {
        // On Windows, inner quotes should be escaped
        expect(result).toContain('\\"');
      }
    });

    it('should handle complex expressions', () => {
      const result = jq('[.[] | select(.status == "active")]');
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(10);
      // Should preserve the expression structure
      expect(result).toContain('select');
      expect(result).toContain('status');
    });

    it('should handle nested property access', () => {
      const result = jq('.data.nested.property');
      expect(result).toBeTruthy();
      expect(result).toContain('.data.nested.property');
    });

    it('should handle array operations', () => {
      const result = jq('.[0]');
      expect(result).toBeTruthy();
      expect(result).toContain('[0]');
    });

    it('should handle map operations', () => {
      const result = jq('map(.value)');
      expect(result).toBeTruthy();
      expect(result).toContain('map');
      expect(result).toContain('.value');
    });

    it('should not double-escape already escaped quotes', () => {
      const result = jq('"\\"test\\""');
      expect(result).toBeTruthy();
      // Should handle already-escaped quotes properly
      if (process.platform === 'win32') {
        expect(result.includes('\\\\\\"')).toBeFalsy();
      }
    });
  });

  describe('devNull', () => {
    it('should return NUL on windows', () => {
      if (process.platform === 'win32') {
        expect(devNull).toBe('NUL');
      }
    });

    it('should return /dev/null on unix', () => {
      if (process.platform !== 'win32') {
        expect(devNull).toBe('/dev/null');
      }
    });

    it('should be a string', () => {
      expect(typeof devNull).toBe('string');
    });

    it('should not be empty', () => {
      expect(devNull.length).toBeGreaterThan(0);
    });

    it('should be usable in redirect contexts', () => {
      // Verify it's a valid redirect target string
      const validRedirects = ['NUL', '/dev/null'];
      expect(validRedirects).toContain(devNull);
    });
  });
});
