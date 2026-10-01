import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    unstubGlobals: true,
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": __dirname },
  },
});
