import { defineConfig } from "vitest/config";

// Standalone test config — keeps unit tests independent of the app's Vite plugins.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
