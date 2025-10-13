import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import importSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import ts from "typescript-eslint";

export default defineConfig({
    files: ["src/**/*.ts", "scripts/**/*.ts", "decompiler/src/**/*.ts", "eslint.config.js"],

    plugins: {
        "@stylistic": stylistic,
        "unused-imports": unusedImports,
        "simple-import-sort": importSort,
    },
    extends: [
        js.configs.recommended,
        ts.configs.recommended,
        stylistic.configs.customize({
            indent: 4,
            quotes: "double",
            braceStyle: "1tbs",
            semi: true,
        }),
    ],

    rules: {
        "@stylistic/arrow-parens": ["error", "as-needed"],
        "@stylistic/generator-star-spacing": ["error", { before: true, after: false }],
        "@stylistic/operator-linebreak": ["error", "before", { overrides: { "=": "after" } }],
        "@stylistic/spaced-comment": ["error", "always", { markers: ["!", "#region", "#endregion"] }],
        "@stylistic/no-mixed-operators": "off",

        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
        "unused-imports/no-unused-imports": "error",

        "@typescript-eslint/no-explicit-any": "off",

        "no-useless-escape": "off",
        "no-var": "off",
        "prefer-const": ["error", { destructuring: "all" }],
    },
});
