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
                    ['types/generated', './types/generated/index']
                ],
                extensions: ['.ts', '.d.ts', '.js', '.jsx', '.json']
            }
        }
    },
    "rules": {
        "@typescript-eslint/no-use-before-define": 1
    }
};
