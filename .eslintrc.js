module.exports = {
    extends: ["airbnb-typescript", "plugin:@typescript-eslint/recommended", "prettier", "prettier/@typescript-eslint"],
    env: {
        node: true,
        browser: true,
        jest: true,
    },
    parserOptions: {
        project: "./tsconfig.json",
    },
    settings: {
        "import/resolver": {
            alias: {
                map: [
                    ["@utils", "./test-utils"],
                    ["types/generated", "./types/generated/index", "types/contracts"],
                ],
                extensions: [".ts", ".d.ts", ".js", ".jsx", ".json"],
            },
        },
    },
    rules: {
        "import/no-extraneous-dependencies": "off",
        "no-console": "off",
        "import/prefer-default-export": "off",
        "no-nested-ternary": 1,
        "no-await-in-loop": 1,
        "no-restricted-syntax": 1,
        "@typescript-eslint/dot-notation": 1,
        "@typescript-eslint/no-use-before-define": 1,
        "@typescript-eslint/no-loop-func": 1,
        "@typescript-eslint/no-unused-expressions": 1,
        "lines-between-class-members": 0,
        "prefer-destructuring": [
            1,
            {
                array: false,
                object: false,
            },
            {
                enforceForRenamedProperties: false,
            },
        ],
    },
    overrides: [
        {
            files: [
                "./types/contracts.ts",
                "./types/interfaces.d.ts",
                "./types/**/*.ts",
                "./scripts/**/*.ts",
                "./test/**/*.ts",
                "./test-utils/**/*.ts",
            ],
        },
    ],
}
