import { MigrationsContract } from "types/generated/Migrations.d";

export default async ({ artifacts }, deployer) => {
    process.env.NETWORK = deployer.network;
    if (deployer.network == "fork") {
        return;
    }

    const cMigrations: MigrationsContract = artifacts.require("Migrations");

    await deployer.deploy(cMigrations);
};
