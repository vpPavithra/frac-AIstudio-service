// ESLint flat config for `npm run lint` (src/**/*.ts and tools/**/*.ts): ESLint and typescript-eslint recommended
// rules, with formatting rules turned off for Prettier. Unused vars warn; a leading "_" marks one as intended.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
