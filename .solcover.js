module.exports = {
    skipFiles: [
        "interfaces",
        "integrations",
        "z_mocks",
        "shared/InitializableReentrancyGuard.sol",
        "integrations",
        "masset/peripheral",
        "masset/versions",
        "peripheral",
        "savings/peripheral",
        "upgradability",
    ],
    mocha: {
        grep: "@skip-on-coverage", // Find everything with this tag
        invert: true, // Run the grep's inverse set.
    },
}
