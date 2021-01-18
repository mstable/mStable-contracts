module.exports = {
    "extends": [
        "airbnb-typescript",
        "plugin:@typescript-eslint/recommended",
        "prettier",
        "prettier/@typescript-eslint"
    ],
    "env": {
        "node": true,
        "browser": true,
        "jest": true
    },
    "parserOptions": {
        "project": "./tsconfig.json"
    },
    "settings": {
        'import/resolver': {
            "alias": {
                map: [
                    ['@utils', './test-utils'],
                    ['types/generated', './types/generated/index', 'types/contracts']
                ],
                extensions: ['.ts', '.d.ts', '.js', '.jsx', '.json']
            }
        }
    },
    "rules": {
        "@typescript-eslint/no-use-before-define": 1,
        "no-nested-ternary": 0
    },
    "overrides": [
        {
            "files": [
                "./types/*.ts",
                "./types/contracts.ts",
                "./types/chai.d.ts",
                "./types/interfaces.d.ts",
                "./types/**/*.ts",
                "./test/*.ts",
                "./scripts/**/*.ts",
                "./test/**/*.ts",
                "./test-utils/*.ts",
                "./test-utils/**/*.ts",
                "./migrations/*.js"],
        }
    ]
};
