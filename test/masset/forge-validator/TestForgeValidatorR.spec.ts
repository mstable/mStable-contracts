import * as t from "types/generated";

import { simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { StandardAccounts } from "@utils/machines/standardAccounts";

import envSetup from "@utils/env_setup";
const { expect, assert } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

contract("ForgeValidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    let forgeValidator: t.ForgeValidatorInstance;

    before("Init contract", async () => {
        forgeValidator = await ForgeValidatorArtifact.new();
    });

    beforeEach("Refresh the Basket objects", async () => {});
});
