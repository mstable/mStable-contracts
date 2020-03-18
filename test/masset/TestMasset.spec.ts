import { MockModuleInstance, MockNexusInstance } from "types/generated";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "../shared/behaviours/PausableModule.behaviour";

contract("Masset", async (accounts) => {
    const ctx: { module?: MockModuleInstance } = {};
    const sa = new StandardAccounts(accounts);

    beforeEach("create masset");

    // TODO After creation of Masset, enable the following behaviours
    // shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
    // shouldBehaveLikePausableModule(ctx as Required<typeof ctx>, sa);

    describe("mint", () => {
        context("when the basket is healthy", () => {
            context("when the basket is under the limit", () => {});

            context("when the basket exceeds the limit", () => {});
        });

        context("when the basket is not healthy", () => {
            it("reverts");
        });
    });

    describe("mintTo", () => {
        context("when the basket is healthy", () => {
            context("when the basket is under the limit", () => {
                context("when the recipient is an EOA", () => {});

                context("when the recipient is a contract ", () => {});

                context("when the recipient is the zero address", () => {});
            });

            context("when the basket exceeds the limit", () => {});
        });

        context("when the basket is not healthy", () => {
            it("reverts");
        });
    });

    describe("redeem", () => {});

    describe("redeemTo", () => {});

    describe("completeRecol", () => {});
});
