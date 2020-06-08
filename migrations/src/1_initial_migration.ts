/* eslint-disable @typescript-eslint/triple-slash-reference,spaced-comment */
/// <reference path="../../types/generated/index.d.ts" />
/// <reference path="../../types/generated/types.d.ts" />

export default async (
    {
        artifacts,
    }: {
        artifacts: Truffle.Artifacts;
    },
    deployer,
): Promise<void> => {
    process.env.NETWORK = deployer.network;
    if (deployer.network === "fork") {
        return;
    }

    const cMigrations = artifacts.require("Migrations");

    await deployer.deploy(cMigrations);
};
