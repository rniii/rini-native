import js from "@eslint/js";
import ts from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";

export default defineConfig({
    files: ["src/*", "scripts/*", "decompiler/src/*"],

    plugins: {
        "@stylistic": stylistic,
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

        "@typescript-eslint/no-explicit-any": "off",

        "no-useless-escape": "off",
        "no-var": "off",
        "prefer-const": ["error", { destructuring: "all" }],
    }
});
