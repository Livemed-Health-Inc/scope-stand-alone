import { defineConfig } from "vitest/config";

// Standalone test config — keeps unit tests independent of the app's Vite plugins.
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  esbuild: { jsx: "automatic" },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
