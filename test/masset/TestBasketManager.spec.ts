import envSetup from "@utils/env_setup";
import * as chai from "chai";

const { expect, assert } = envSetup.configure();
contract("BasketManager", async (accounts) => {
    before("", async () => {});

    describe("behaviours:", async () => {
        describe("should behave like a Module", async () => {
            // should behave like Module
        });
    });

    describe("initialize()", () => {
        describe("should fail", () => {
            it("when nexus address is zero");

            it("when mAsset address is zero");

            it("when grace value is not in range");

            it("when bAsset array is empty");

            it("when a bAsset already exist");

            it("when array not have equal length");

            it("when already initialized");
        });

        describe("with valid parameters", async () => {
            it("should have initialized with nexus");

            it("should have mAsset address");

            it("should have default basket configurations");

            it("should have all bAssets added + events");

            it("should have all bAsset's integrations addresses");

            it("should have all expected transferFee flag for each bAsset");

            it("should have expected weight");
        });
    });

    describe("increaseVaultBalance()", async () => {
        it("should fail when called by other than masset contract");

        it("should fail when basket is failed");

        it("should fail when invalid basket index");

        it("should succeed for a valid basket index");
    });

    describe("increaseVaultBalances()", async () => {
        it("should fail when called by other than masset contract");

        it("should fail when basket is failed");

        it("should fail when number of elements are more than number of bAssets");

        it("should fail when array length and len not match");

        it("should succeed and increase vault balance");
    });

    describe("decreaseVaultBalance()", async () => {
        it("should fail when called by other than masset contract");

        it("should fail when basket is failed");

        it("should fail when invalid basket index");

        it("should succeed for a valid basket index");
    });

    describe("decreaseVaultBalances()", async () => {
        it("should fail when called by other than masset contract");

        it("should fail when basket is failed");

        it("should fail when number of elements are more than number of bAssets");

        it("should fail when array length and len not match");

        it("should succeed and decrease vault balance");
    });

    describe("collectInterest()", async () => {
        beforeEach("", async () => {
            // deposit to mock platforms
        });

        it("should have interested generated");
        it("todo...");
    });

    describe("addBasset()", async () => {
        describe("should fail", async () => {
            it("when bAsset address is zero");

            it("when integration address is zero");

            it("when bAsset already exist");

            it("when measurement multiple is out of range");
        });

        it("should calculate the ratio correctly");

        it("should allow for various measurementmultiples (under certain limit)");
    });

    describe("setBasketWeights()", async () => {
        it("should fail when empty array passed");

        it("should update the weights");

        it("should throw if some bassets are in an recollateralising state");
    });

    describe("setTransferFeesFlag()", async () => {
        it("should fail when not called by manager or governor");

        it("should fail when bAsset address is zero");

        it("should fail when bAsset not exist");

        it("should succeed for valid bAsset");

        it("should emit event on fee enabled / disabled");
    });

    describe("setGrace()", async () => {
        it("should fail when not called by manager or governor");

        it("should fail when grace is out of range");

        it("should update when in range");
    });

    describe("removeBasset()", async () => {
        describe("should fail", async () => {
            it("when basket is not healthy");

            it("when not called by manager or governor");

            it("when bAsset address is zero");

            it("when bAsset address not exist");

            it("when bAsset targetWeight is non zero");

            it("when bAsset vault balance is non zero");

            it("when bAsset is not active");
        });

        it("should succeed when request is valid");
    });

    describe("getBasket()", async () => {
        it("get full basket with all parameters");
    });

    describe("prepareForgeBasset()", async () => {
        it("should fail when wrong token is passed");

        it("should return ForgeProps");
    });

    describe("prepareForgeBassets()", async () => {
        it("should fail when wrong bitmap is passed");

        it("should return ForgePropsMulti");
    });

    describe("getBassets()", async () => {
        it("should get all bAssets");
    });

    describe("getBasset()", async () => {
        it("should failed when token address is passed");

        it("should return bAsset");
    });

    describe("getBassetIntegrator()", async () => {
        it("should failed when token address is passed");

        it("should return integrator");
    });

    describe("getBitmapFor()", async () => {
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

    describe("handlePegLoss()", async () => {
        it("should fail when not called by manager or governor");

        it("should fail when basket is not healthy");

        it("should fail when bAsset not exist");
    });

    describe("negateIsolation()", async () => {
        it("should fail when not called by manager or governor");
    });

    // =====

    it("Should convert bitmap to index array", async () => {
        // let indexes = await masset.convertBitmapToIndexArr(3, 2);
        // console.log(indexes);
        // TODO (3,3) will return indexes[0,1,0] which is wrong
        // TODO need to look for solution
        // shouldFail(await masset.convertBitmapToIndexArr(3, 3));
        // console.log(indexes);
    });
});
