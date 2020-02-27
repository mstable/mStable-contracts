import { StandardAccounts } from "@utils/machines";
import { exactAmountToSimple, simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import { PublicStableMathInstance } from "types/generated";

const { expect, assert } = envSetup.configure();
const PublicStableMath = artifacts.require("PublicStableMath");

contract("StableMath", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let math: PublicStableMathInstance;

    beforeEach(async () => {
        math = await PublicStableMath.deployed(sa._);
    });

    /** *************************************
                    GETTERS
    *************************************** */

    it("should have the correct scale", async () => {
        expect(await math.getFullScale()).bignumber.eq(simpleToExactAmount(1, 18));
    });

    it("should have the correct ratio scale", async () => {
        expect(await math.getRatioScale()).bignumber.eq(simpleToExactAmount(1, 8));
    });

    it("should scale an integer correctly", async () => {
        expect(await math.scaleInteger("1000")).bignumber.eq(simpleToExactAmount(1000, 18));
        expect(await math.scaleInteger("7")).bignumber.eq(simpleToExactAmount(7, 18));
        expect(await math.scaleInteger("111231231231")).bignumber.eq(
            simpleToExactAmount(111231231231, 18),
        );
        expect(await math.scaleInteger(simpleToExactAmount(1, 18))).bignumber.eq(
            simpleToExactAmount(1, 36),
        );
    });

    /** *************************************
              PRECISE ARITHMETIC
    *************************************** */

    it("should return correct results from mulTruncate(x, y)", async () => {});

    it("should return correct results from mulTruncate(x, y, scale)", async () => {});

    it("should return correct results from mulTruncateCeil(x, y)", async () => {});

    it("should return correct results from divPrecisely(x, y)", async () => {});

    /** *************************************
                  RATIO FUNCS
    *************************************** */

    it("should calculate correct mAsset value from bAsset in mulRatioTruncate(x, ratio)", async () => {});

    it("should calculate correct mAsset value from bAsset in mulRatioTruncateCeil(x, ratio)", async () => {});

    it("should calculate correct bAsset value from mAsset in divRatioPrecisely(x, ratio)", async () => {});

    /** *************************************
                    HELPERS
    *************************************** */

    it("should find the minimum number in min(x, y)", async () => {});

    it("should find the maximum number in max(x, y)", async () => {});

    it("should clamp to the upper bound in clamp(x, upperBound)", async () => {});
});
