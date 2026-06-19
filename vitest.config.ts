import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    // Never collect tests from sibling git worktrees nested under .claude/ —
    // their separate node_modules cause dual-React failures and false negatives.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
