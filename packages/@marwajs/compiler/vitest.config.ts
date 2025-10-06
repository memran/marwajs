import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/**/*.spec.ts"],
    exclude: ["tests/helpers.ts", "/tests/runtime/*.ts"],
  },
});
