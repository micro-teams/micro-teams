import { defineConfig } from "@playwright/test";

// run.sh sets these; local defaults are only for iterating on the test file itself against a
// stack already left up with --keep.
export default defineConfig({
  testDir: ".",
  timeout: 5 * 60 * 1000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:52181",
    headless: true,
    trace: "retain-on-failure",
  },
});
