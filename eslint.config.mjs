import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The root /[handle] bio route makes this rule treat every "/x" href,
    // API routes included, as a page link.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".impeccable/**",
  ]),
]);

export default eslintConfig;
