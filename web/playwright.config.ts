import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    permissions: ["camera"],
    // Chromium's built-in fake webcam, so "Mock: webcam" works headless and in CI.
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: {
    // Test the static build that gets deployed; also avoids clashing with `next dev` on 8888.
    command: `npm run build && npx serve out --listen ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
