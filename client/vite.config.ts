import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  // Der Editor (TipTap/ProseMirror, ~500 kB) ist ein eigener, erst beim Bearbeiten nachgeladener Chunk
  build: { chunkSizeWarningLimit: 600 },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000', '/sounds/default/': 'http://127.0.0.1:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    coverage: { include: ['src/**'], exclude: ['src/main.ts'] },
  },
});
