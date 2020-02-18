import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";


import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { NexusInstance } from "types/generated";

const Nexus = artifacts.require("Nexus");


envSetup.configure();
const { expect, assert } = chai;

contract("Nexus", async (accounts) => {
    let sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: NexusInstance;

    beforeEach("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
        nexus = await systemMachine.deployNexus();
    });

    describe("Setup", () => {
        it("should have correct default parameters");
    });

    describe("initialize()", () => {
        context("Initialize Nexus", () => {
            context("Should Success", () => {
                it("with default module");
                it("with all modules");
                it("default with locked Systok module");
                it("default with unlocked module");
                it("only allowed with governor");
                it("should be initialized");
            });
            context("Should Fail", () => {
                it("not initialize with same module address");
                it("not initialize when empty array");
                it("not initialize when wrong array length");
                it("not initialize other than governor");
                it("should not be initialized");
            });

        });
    });

    describe("requestModule()", () => {
        it("call should fail when not initialized");
    });

    describe("cancelProposedModule", () => {
        it("call should fail when not initialized");
    });

    describe("addProposedModule()", () => {
        it("call should fail when not initialized");
    });

    describe("addProposedModules()", () => {
        it("call should fail when not initialized");
    });

    describe("requestLockModule()", () => {
        it("call should fail when not initialized");
    });

    describe("cancelLockModule()", () => {
        it("call should fail when not initialized");
    });

});