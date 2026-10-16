import { defineConfig } from 'vitest/config';
import path from 'node:path';

const integration = process.env.RUN_INTEGRATION === '1';
const shared = path.resolve(__dirname, 'services/shared/src');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@orderly\/shared$/, replacement: path.join(shared, 'index.ts') },
      { find: /^@orderly\/shared\/(.*)$/, replacement: path.join(shared, '$1') },
    ],
  },
  test: {
    // Unit tests: *.test.ts (sin red). Integration: *.integration.test.ts (requieren docker compose up).
    include: integration ? ['services/**/*.integration.test.ts'] : ['services/**/*.test.ts'],
    exclude: integration ? ['node_modules/**', 'dist/**'] : ['**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
    clearMocks: true,
  },
});
