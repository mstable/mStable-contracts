import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BigNumber } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance } from "types/generated";

const MassetArtifact = artifacts.require("Masset");

envSetup.configure();
const { expect, assert } = chai;

contract("MassetMinting", async (accounts) => {
  const sa = new StandardAccounts(accounts);
  let systemMachine: SystemMachine;
  let masset: MassetInstance;
  let b1, b2, b3, b4, b5, b6, b7;

  before("Init contract", async () => {
    systemMachine = new SystemMachine(accounts, sa.other);
    await systemMachine.initialiseMocks();
    const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

    // 1. Deploy Bassets
    b1 = await bassetMachine.deployERC20Async();
    b2 = await bassetMachine.deployERC20Async();
    b3 = await bassetMachine.deployERC20Async();
    b4 = await bassetMachine.deployERC20Async();
    b5 = await bassetMachine.deployERC20Async();
    b6 = await bassetMachine.deployERC20Async();
    b7 = await bassetMachine.deployERC20Async();

    // 2. Masset contract deploy
    masset = await MassetArtifact.new(
      "TestMasset",
      "TMT",
      systemMachine.nexus.address,
      [b1.address, b2.address, b3.address, b4.address, b5.address, b6.address, b7.address],
      [aToH("b1"), aToH("b2"), aToH("b3"), aToH("b4"), aToH("b5"), aToH("b6"), aToH("b7")],
      [
        percentToWeight(30),
        percentToWeight(30),
        percentToWeight(30),
        percentToWeight(30),
        percentToWeight(20),
        percentToWeight(20),
        percentToWeight(20),
      ],
      [
        createMultiple(1),
        createMultiple(1),
        createMultiple(1),
        createMultiple(1),
        createMultiple(1),
        createMultiple(1),
        createMultiple(1),
      ],
      sa.feePool,
      systemMachine.forgeValidator.address,
    );
  });

  describe("Minting", () => {
    it("Should mint multiple bAssets", async () => {
      await b1.approve(masset.address, 10, { from: sa.default });
      await b2.approve(masset.address, 10, { from: sa.default });
      await b3.approve(masset.address, 10, { from: sa.default });
      await b4.approve(masset.address, 10, { from: sa.default });
      await b5.approve(masset.address, 10, { from: sa.default });
      await b6.approve(masset.address, 10, { from: sa.default });
      await b7.approve(masset.address, 10, { from: sa.default });

      const mUSD_balBefore = await masset.balanceOf(sa.default);
      await masset.mintBitmapTo(127, [10, 10, 10, 10, 10, 10, 10], sa.default);
      const mUSD_balAfter = await masset.balanceOf(sa.default);
      // assert(mUSD_balBefore.eq(new BN(0)));
      // assert(mUSD_balAfter.eq(new BN(10)));
    });

    it("Should mint 2 bAssets", async () => {
      await b1.approve(masset.address, 10, { from: sa.default });
      // await b2.approve(masset.address, 10, { from: sa.default });
      await b3.approve(masset.address, 10, { from: sa.default });
      // await b4.approve(masset.address, 10, { from: sa.default });

      const bitmap = 5; // 0101 = 5
      await masset.mintBitmapTo(bitmap, [10, 10], sa.default, { from: sa.default });
    });

    it("Should mint single bAsset", async () => {
      await b1.approve(masset.address, 10, { from: sa.default });
      await masset.mintSingle(b1.address, 10, { from: sa.default });
    });

    it("Should return bAssets bitmap", async () => {
      // Returns two bit set, as there are only two bAssets
      const bitmap = await masset.getBitmapForAllBassets();
      // console.log(bitmap);
      assert(bitmap.eq(new BigNumber(127)), "wrong bitmap");

      // Result sets only first bit, as b1 is at first index in bAsset array
      // bitmap = await masset.getBitmapFor([b1.address]);
      // assert(bitmap.eq(new BN(1)));

      // Result sets only second bit, as b2 is at second index in bAsset array
      // bitmap = await masset.getBitmapFor([b2.address]);
      // assert(bitmap.eq(new BN(2)));

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

    it("Should mint selected bAssets only", async () => { });
  });
});
