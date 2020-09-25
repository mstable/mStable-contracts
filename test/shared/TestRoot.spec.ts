import { BN } from "@utils/tools";
import * as t from "types/generated";
import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();
const Root = artifacts.require("MockRoot");

describe("Root", function() {
    let root: t.MockRootInstance;
    beforeEach(async () => {
        root = await Root.new();
    });

    describe("calculating the root", () => {
        it("returns floored root", async () => {
            let amt = new BN(1000000000);
            let res = await root.sqrt(amt);
            expect(res).bignumber.eq(new BN(31622));
            amt = new BN(64);
            res = await root.sqrt(amt);
            expect(res).bignumber.eq(new BN(8));
            amt = new BN("160000000000000000");
            res = await root.sqrt(amt);
            expect(res).bignumber.eq(new BN(400000000));
        });
        it("returns root for seconds in year", async () => {
            const amt = new BN("31540000");
            const res = await root.sqrt(amt);
            expect(res).bignumber.eq(new BN(5616));
        });
        it("returns root for seconds in 6 months", async () => {
            const amt = new BN("15724800");
            const res = await root.sqrt(amt);
            expect(res).bignumber.eq(new BN(3965));
        });
        it("returns root for seconds in week", async () => {
            const amt = new BN("604800");
            const res = await root.sqrt(amt);
            expect(res).bignumber.eq(new BN(777));
        });
    });
});
