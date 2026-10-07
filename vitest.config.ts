import { defineConfig } from 'vitest/config';

// The repo scripts in scripts/ have their own node:test suite (`pnpm test:scripts`), so Vitest only runs src/.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
