
import { BigNumber } from "@0x/utils";
import { percentToWeight, simpleToExactAmount } from "./math";
import { ZERO_ADDRESS } from "./constants";

/**
 * @notice Relevant object interfaces and helper methods to initialise mock instances of those interfaces
 * This will also qualify for mStable-Js lib at some stage
 */

export interface Basket {
  bassets: Basset[];
  expiredBassets: string[];
  grace: BigNumber;
}

export enum BassetStatus {
  Normal,
  BrokenBelowPeg,
  BrokenAbovePeg,
}

export interface Basset {
  addr: string;
  decimals: BigNumber;
  key: string;
  ratio: BigNumber;
  targetWeight: BigNumber;
  vaultBalance: BigNumber;
  status: BassetStatus;
}

export const createBasket = (bassets: Basset[], grace = 0): Basket => {
  return {
    bassets,
    expiredBassets: [],
    grace: percentToWeight(grace),
  };
};

export const createBasset = (targetWeight, vaultBalance, decimals = 18, status = BassetStatus.Normal): Basset => {
  return {
    addr: ZERO_ADDRESS,
    decimals: new BigNumber(decimals),
    key: "0x",
    ratio: new BigNumber(10).pow(new BigNumber(18 - decimals)),
    targetWeight: percentToWeight(targetWeight),
    vaultBalance: simpleToExactAmount(vaultBalance, decimals),
    status,
  };
};
