import { defineConfig } from '@playwright/test';

// Smoke test of the static export (`NEXT_EXPORT=true npm run build` → out/) in
// a real browser, with /api mocked. It exists so dependency updates that break
// the app at runtime (not at build time) fail CI.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'node e2e/serve.mjs out 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
  },
});
