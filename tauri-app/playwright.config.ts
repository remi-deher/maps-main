import { defineConfig, devices } from "@playwright/test";

// End-to-end coverage of the web build — the `-tags webui` product, where the
// engine serves this same UI to a plain browser.
//
// The unit tests (vitest + jsdom) check pieces; these check that the pieces are
// wired together: that the pairing gate actually gates, that a STATUS envelope
// reaches the widgets that display it, that opening the settings modal doesn't
// throw. None of that is visible to a jsdom test of a single component, and it
// is exactly the class of breakage a big refactor introduces.
//
// The engine itself is stubbed at the WebSocket boundary (see
// e2e/fixtures/engineStub.ts) rather than launched: these are tests of the
// client's behaviour against the documented envelope format, and keeping them
// hermetic means they run in CI without a device, a tunnel, or a Go build.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
