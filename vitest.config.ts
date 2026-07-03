import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Renderer hook/component tests opt into jsdom per-file via `// @vitest-environment jsdom`.
// Main-process/pure tests run in the default node environment.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**']
    }
  }
})
