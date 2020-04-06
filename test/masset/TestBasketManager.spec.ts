import envSetup from "@utils/env_setup";
import * as chai from "chai";

const { expect, assert } = envSetup.configure();
contract("MassetBasket", async (accounts) => {
    describe("Initialising the basket", () => {
        it("should throw if the weightings dont add up to..");
    });

    describe("Adding a basset the basket", () => {
        it("should calculate the ratio correctly");
        it("should allow for various measurementmultiples (under certain limit)");
        it("should not allow the basset if...");
    });

    describe("Setting weights on the basket", () => {
        it("should update the weights if..");
        it("should throw if some bassets are in an recollateralising state");
    });

    it("Should return bAssets bitmap", async () => {
        // Returns two bit set, as there are only two bAssets
        // const bitmap = await masset.getBitmapForAllBassets();
        // expect(bitmap, "wrong bitmap").bignumber.eq(new BN(127));
        // Result sets only first bit, as b1 is at first index in bAsset array
        // bitmap = await masset.getBitmapFor([b1.address]);
        // expect(bitmap).bignumber.eq(new BN(1));
        // Result sets only second bit, as b2 is at second index in bAsset array
        // bitmap = await masset.getBitmapFor([b2.address]);
        // expect(bitmap).bignumber.eq(new BN(2));
        // TODO add test for 0 items
        // TODO add test for 32 items
        // TODO add test for more than 32 items
    });

    it("Should convert bitmap to index array", async () => {
        // let indexes = await masset.convertBitmapToIndexArr(3, 2);
        // console.log(indexes);
        // TODO (3,3) will return indexes[0,1,0] which is wrong
        // TODO need to look for solution
        // shouldFail(await masset.convertBitmapToIndexArr(3, 3));
        // console.log(indexes);
    });
});
