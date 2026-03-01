import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/component/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.vue"],
      exclude: ["src/main.ts", "src/main-window.ts", "src/**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
