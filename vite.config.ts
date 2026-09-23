import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
