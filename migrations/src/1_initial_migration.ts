import { MigrationsContract } from "types/generated";

export default async ({ artifacts }, deployer) => {
    process.env.NETWORK = deployer.network;

    const cMigrations: MigrationsContract = artifacts.require("Migrations");

    await deployer.deploy(cMigrations);
};
