import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/FastSplit/' : '/',
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
