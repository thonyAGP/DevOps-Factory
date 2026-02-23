import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    include: ['scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['scripts/**/*.ts'],
      exclude: ['scripts/**/*.test.ts', 'scripts/__tests__/**'],
      thresholds: {
        'scripts/core/**': {
          statements: 80,
          branches: 70,
          functions: 70,
          lines: 80,
        },
      },
    },
  },
});
