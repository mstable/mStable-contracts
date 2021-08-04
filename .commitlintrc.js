module.exports = {
    extends: ["@commitlint/config-conventional"],
    rules: {
        "scope-case": [2, "always", "lower-case"],
        "subject-case": [2, "always", "sentence-case"],
    },
}
