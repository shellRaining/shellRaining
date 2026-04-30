import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shellraining/system-prompt": new URL(
        "./packages/system-prompt/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    exclude: ["**/.worktrees/**", "**/dist/**", "**/node_modules/**"],
    include: ["tests/**/*.test.ts", "apps/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
  },
});
