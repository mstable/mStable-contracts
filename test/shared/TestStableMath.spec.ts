import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";

import { StandardAccounts } from "@utils/machines";
import { exactToSimpleAmount, simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import { PublicStableMathInstance } from "types/generated";

const { expect, assert } = envSetup.configure();
const PublicStableMath = artifacts.require("PublicStableMath");

contract("StableMath", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let math: PublicStableMathInstance;

    beforeEach(async () => {
        math = await PublicStableMath.new();
    });

    /***************************************
                    GETTERS
    ****************************************/

    describe("calling the getters", async () => {
        it("should return the correct scale", async () => {
            expect(await math.getFullScale()).bignumber.eq(simpleToExactAmount(1, 18));
        });

        it("should return the correct ratio scale", async () => {
            expect(await math.getRatioScale()).bignumber.eq(simpleToExactAmount(1, 8));
        });

        it("should be able to go to and from both kinds of units", async () => {
            expect(exactToSimpleAmount(simpleToExactAmount(1, 18), 18)).bignumber.eq(new BN(1));
            expect(exactToSimpleAmount(simpleToExactAmount("0.5", 10), 10)).bignumber.eq(
                new BN("0.5"),
            );
        });
    });

    describe("scaling an integer", async () => {
        it("should scale an integer correctly", async () => {
            expect(await math.scaleInteger("1000")).bignumber.eq(simpleToExactAmount(1000, 18));
            expect(await math.scaleInteger("7")).bignumber.eq(simpleToExactAmount(7, 18));
            expect(await math.scaleInteger("111231231231")).bignumber.eq(
                simpleToExactAmount(111231231231, 18),
            );
            expect(await math.scaleInteger(simpleToExactAmount(1, 18))).bignumber.eq(
                simpleToExactAmount(1, 36),
            );
            expect(await math.scaleInteger(1)).bignumber.eq(simpleToExactAmount(1, 18));
        });

        it("should fail if integer overflow", async () => {
            await shouldFail.reverting.withMessage(
                math.scaleInteger(simpleToExactAmount(1, 70)),
                "SafeMath: multiplication overflow",
            );
        });
    });

    /***************************************
            PRECISE ARITHMETIC
    ****************************************/

    describe("calling mulTruncate(x, y, scale)", async () => {
        it("should return correct results", async () => {
            var x = simpleToExactAmount(1, 10);
            var y = simpleToExactAmount(9, 9);
            var scale = simpleToExactAmount(1, 12);
            var result = await math.mulTruncateScale(x, y, scale);
            expect(result).bignumber.eq(new BN(x).mul(y).div(scale));
            expect(result).bignumber.lt(x as any);

            x = simpleToExactAmount(250, 22);
            y = simpleToExactAmount(95, 16);
            scale = simpleToExactAmount(1, 18);
            result = await math.mulTruncateScale(x, y, scale);
            expect(result).bignumber.eq(new BN(x).mul(y).div(scale));
            expect(result).bignumber.lt(x as any);
        });
        it("should ignore fractions", async () => {
            var x = new BN(11);
            var y = new BN(3);
            // 33 / 10 == 3.33.. should return 3
            var result = await math.mulTruncateScale(x, y, new BN(10));
            expect(result).bignumber.eq(new BN(3));
        });
        it("should fail if scale operand is 0", async () => {
            var sampleInput = simpleToExactAmount(1, 18);
            await shouldFail.reverting.withMessage(
                math.mulTruncateScale(sampleInput, sampleInput, 0),
                "SafeMath: division by zero",
            );
        });
    });

    describe("calling mulTruncate(x, y)", async () => {
        it("should return correct results", async () => {
            var x = simpleToExactAmount(1, 10);
            var y = simpleToExactAmount(9, 9);
            var result = await math.mulTruncate(x, y);
            expect(result).bignumber.eq(new BN(x).mul(y).div(simpleToExactAmount(1, 18)));
            expect(result).bignumber.lt(x as any);

            x = simpleToExactAmount(1, 20);
            y = simpleToExactAmount(25, 16);
            result = await math.mulTruncate(x, y);
            expect(result).bignumber.eq(simpleToExactAmount(25, 18));
            expect(result).bignumber.lt(x as any);
        });

        it("should return 0 if either operand is 0", async () => {
            expect(await math.mulTruncate(new BN(0), simpleToExactAmount(1, 18))).bignumber.eq(
                new BN(0),
            );
            expect(await math.mulTruncate(simpleToExactAmount(1, 18), new BN(0))).bignumber.eq(
                new BN(0),
            );
        });
    });

    describe("calling mulTruncateCeil(x, y)", async () => {
        it("should round up any fraction", async () => {
            var x = new BN(3);
            var y = simpleToExactAmount(11, 17);
            // (3 * 11e17) / 1e18 == 33e17 / 1e18 == 3.3.
            var result = await math.mulTruncateCeil(x, y);
            expect(result).bignumber.eq(new BN(4));

            x = new BN(1);
            y = simpleToExactAmount(95, 16);
            // (1 * 95e16) / 1e18 == 0.95
            result = await math.mulTruncateCeil(x, y);
            expect(result).bignumber.eq(new BN(1));
        });
        it("should not round a 0 fraction", async () => {
            var x = simpleToExactAmount(11, 17);
            var y = new BN(30);
            // (11e17 * 30) / 1e18 == 33e18 / 1e18 == 33
            var result = await math.mulTruncateCeil(x, y);
            expect(result).bignumber.eq(new BN(33));
        });
    });

    describe("calling divPrecisely(x, y)", async () => {
        it("should return correct results from divPrecisely(x, y)", async () => {});
    });

    /***************************************
                RATIO FUNCS
    ****************************************/

    describe("calling mulRatioTruncate(x, ratio)", async () => {
        it("calculate correct mAsset value from bAsset in mulRatioTruncate(x, ratio)", async () => {});
    });

    describe("calling mulRatioTruncateCeil(x, ratio)", async () => {
        it("shoushould calculate correct mAsset value from bAsset in mulRatioTruncateCeil(x, ratio)", async () => {});
    });

    describe("calling divRatioPrecisely(x, ratio)", async () => {
        it("should calculate correct bAsset value from mAsset in divRatioPrecisely(x, ratio)", async () => {});
    });

    /** *************************************
                    HELPERS
    *************************************** */

    describe("calling min(x, y)", async () => {
        it("should find the minimum number", async () => {});
    });

    describe("calling max(x, y)", async () => {
        it("should find the maximum number", async () => {});
    });

    describe("calling clamp(x, uepprBound)", async () => {
        it("should clamp to the upper bound", async () => {});
    });
});
