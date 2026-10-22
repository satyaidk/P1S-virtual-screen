import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Second server running in hosted (Vercel-like) mode: Bambu Cloud only, cookie sessions. */
const HOSTED_PORT = PORT + 1;
// Use a pre-installed Chromium when provided (e.g. CI containers); otherwise Playwright's own.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const chrome = { ...devices["Desktop Chrome"], launchOptions: { executablePath } };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /hosted\.spec\.ts/,
      use: { ...chrome, baseURL: `http://localhost:${PORT}` },
    },
    {
      name: "hosted",
      testMatch: /hosted\.spec\.ts/,
      use: { ...chrome, baseURL: `http://localhost:${HOSTED_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx next start -p ${PORT}`,
      // Keep e2e runs away from a real saved Bambu session.
      env: { P1S_DATA_DIR: "test-results/e2e-data" },
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx next start -p ${HOSTED_PORT}`,
      env: { P1S_HOSTED: "1", P1S_SESSION_SECRET: "e2e-only-secret-that-is-long-enough-123" },
      url: `http://localhost:${HOSTED_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
