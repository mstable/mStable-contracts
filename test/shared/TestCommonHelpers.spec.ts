import { expectRevert } from "@openzeppelin/test-helpers";

import { StandardAccounts } from "@utils/machines";
import { BN } from "@utils/tools";
import { ZERO_ADDRESS } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

const { expect } = envSetup.configure();

const MockCommonHelpers = artifacts.require("MockCommonHelpers");
const MockErc20 = artifacts.require("MockERC20");

contract("CommonHelpers", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let commonHelpers: t.MockCommonHelpersInstance;

    before(async () => {
        commonHelpers = await MockCommonHelpers.new();
    });

    describe("getting decimals of valid ERC20 token", async () => {
        let validToken1: t.MockERC20Instance;
        let validToken2: t.MockERC20Instance;
        let validToken3: t.MockERC20Instance;

        before(async () => {
            validToken1 = await MockErc20.new("Mock", "MK1", 4, sa.default, 1);
            validToken2 = await MockErc20.new("Mock", "MK2", 14, sa.default, 1);
            validToken3 = await MockErc20.new("Mock", "MK3", 18, sa.default, 1);
        });

        it("should return the correct decimals from `getDecimals`", async () => {
            const decimals1 = await commonHelpers.getDecimals(validToken1.address);
            expect(decimals1).bignumber.eq(new BN(4));
            const decimals2 = await commonHelpers.getDecimals(validToken2.address);
            expect(decimals2).bignumber.eq(new BN(14));
            const decimals3 = await commonHelpers.getDecimals(validToken3.address);
            expect(decimals3).bignumber.eq(new BN(18));
        });
    });
    describe("getting decimals of invalid ERC20 tokens", async () => {
        let tokenWith0: t.MockERC20Instance;
        let tokenWith2: t.MockERC20Instance;
        let tokenWith19: t.MockERC20Instance;
        let tokenWithXX: t.MockERC20Instance;

        before(async () => {
            tokenWith0 = await MockErc20.new("Mock", "MK0", new BN(0), sa.default, 1);
            tokenWith2 = await MockErc20.new("Mock", "MK2", new BN(2), sa.default, 1);
            tokenWith19 = await MockErc20.new("Mock", "MK4", new BN(19), sa.default, 1);
            tokenWithXX = await MockErc20.new("Mock", "MK6", new BN(128), sa.default, 1);
        });
        it("should be set up", async () => {
            expect(await tokenWith0.decimals()).bignumber.eq(new BN(0));
            expect(await tokenWith2.decimals()).bignumber.eq(new BN(2));
            expect(await tokenWith19.decimals()).bignumber.eq(new BN(19));
            expect(await tokenWithXX.decimals()).bignumber.eq(new BN(128));
        });

        it("should fail if passed dud addresses", async () => {
            await expectRevert.unspecified(commonHelpers.getDecimals(ZERO_ADDRESS));
            await expectRevert.unspecified(commonHelpers.getDecimals(sa.default));
        });
        it("should fail if the token has lt 4 or gt 18 decimals", async () => {
            await expectRevert(
                commonHelpers.getDecimals(tokenWith0.address),
                "Token must have sufficient decimal places",
            );
            await expectRevert(
                commonHelpers.getDecimals(tokenWith2.address),
                "Token must have sufficient decimal places",
            );
            await expectRevert(
                commonHelpers.getDecimals(tokenWith19.address),
                "Token must have sufficient decimal places",
            );
            await expectRevert(
                commonHelpers.getDecimals(tokenWithXX.address),
                "Token must have sufficient decimal places",
            );
        });
    });
});
