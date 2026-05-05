import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/.worktrees/**", "**/dist/**", "**/node_modules/**"],
    include: ["tests/**/*.test.ts", "apps/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
  },
});
