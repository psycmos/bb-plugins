import { defineConfig } from "@playwright/test";

// Another worktree's run may hold the default port; E2E_PORT picks another.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    // The fixture bundle is static; build it once, then serve the folder with
    // the no-dependency server in `serve.mjs`.
    command: "node build.mjs && node serve.mjs",
    cwd: "./e2e",
    url: `http://127.0.0.1:${port}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
