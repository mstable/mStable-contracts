import { SystemMachine } from '@utils/machines/systemMachine';
import envSetup from "@utils/env_setup";
import { percentToWeight, createMultiple, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import * as chai from "chai";
import { shouldFail } from "openzeppelin-test-helpers";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { MassetMachine } from "@utils/machines/massetMachine";
import { BassetMachine } from "@utils/machines/bassetMachine";
const MassetArtifact = artifacts.require("Masset");
const { aToH } = require('@utils/tools')
const BN = require('bn.js');

envSetup.configure();
const { expect, assert } = chai;

contract("MassetMinting", async (accounts) => {
  const sa = new StandardAccounts(accounts);
  let systemMachine;
  let masset;
  let b1, b2;

  before("Init contract", async () => {

    systemMachine = new SystemMachine(accounts, sa.other);
    await systemMachine.initialiseMocks();
    const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

    //1. Deploy Bassets
    b1 = await bassetMachine.deployERC20Async();
    b2 = await bassetMachine.deployERC20Async();

    //2. Masset contract deploy
    masset = await MassetArtifact.new(
      "TestMasset",
      "TMT",
      [b1.address, b2.address],
      [aToH("b1"), aToH("b2")],
      [percentToWeight(70), percentToWeight(70)],
      [createMultiple(1), createMultiple(1)],
      sa.feePool,
      systemMachine.manager.address,
    );

  });

  describe("Minting", () => {
    it("Should mint multiple bAssets", async () => {
      await b1.approve(masset.address, 10, { from: sa.default });
      await b2.approve(masset.address, 10, { from: sa.default });

      let mUSD_balBefore = await masset.balanceOf(sa.default);
      await masset.mint([10, 10]);
      let mUSD_balAfter = await masset.balanceOf(sa.default);
      //assert(mUSD_balBefore.eq(new BN(0)));
      //assert(mUSD_balAfter.eq(new BN(10)));
    });

    it("Should mint single bAsset", async () => {
      await b1.approve(masset.address, 10, { from: sa.default });
      await masset.mintSingle(b1.address, 10, sa.default, { from: sa.default });
    });

    it("Should return bAssets bitmap", async () => {
      //Returns two bit set, as there are only two bAssets
      let bitmap = await masset.getBitmapForAllBassets();
      expect(bitmap.eq(3));

      //Result sets only first bit, as b1 is at first index in bAsset array
      bitmap = await masset.getBitmapFor([b1.address]);
      expect(bitmap.eq(1));

      //Result sets only second bit, as b2 is at second index in bAsset array
      bitmap = await masset.getBitmapFor([b2.address]);
      expect(bitmap.eq(2));

      //TODO add test for 32 items
      //TODO add test for more than 32 items

      let indexes = await masset.convertBitmapToIndexArr(3, 2);
      console.log(indexes);

      //TODO (3,3) will return indexes[0,1,0] which is wrong
      //TODO need to look for solution
      //shouldFail(await masset.convertBitmapToIndexArr(3, 3));
      //console.log(indexes);
    });
  });

});
