import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // All tested logic is pure — no DOM, no React rendering.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
