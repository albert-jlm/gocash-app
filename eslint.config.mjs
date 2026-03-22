import path from "node:path";
import { fileURLToPath } from "node:url";
import eslintrc from "./node_modules/.pnpm/node_modules/@eslint/eslintrc/dist/eslintrc.cjs";

const { FlatCompat } = eslintrc;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
      "android/**",
      "ios/**",
      "supabase/functions/**",
    ],
  },
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
  }),
];

export default config;
