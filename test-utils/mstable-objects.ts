
import { BigNumber } from '@0x/utils';

import { ZERO_ADDRESS } from './constants';
import { createMultiple, percentToWeight, simpleToExactAmount } from './math';

/**
 * @notice Relevant object interfaces and helper methods to initialise mock instances of those interfaces
 * This will also qualify for mStable-Js lib at some stage
 */

export interface Basket {
  bassets: Basset[];
  expiredBassets: string[];
  grace: BigNumber;
  failed: boolean;
  collateralisationRatio: BigNumber;
}

export enum BassetStatus {
  Normal,
  BrokenBelowPeg,
  BrokenAbovePeg,
  Liquidating,
  Liquidated,
  Failed,
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

export const createBasket = (bassets: Basset[], grace = 0, failed = false): Basket => {
  return {
    bassets,
    expiredBassets: [],
    grace: percentToWeight(grace),
    failed,
    collateralisationRatio: percentToWeight(100),
  };
};

export const createBasset = (targetWeight, vaultBalance, decimals = 18, status = BassetStatus.Normal): Basset => {
  return {
    addr: ZERO_ADDRESS,
    decimals: new BigNumber(decimals),
    key: "0x",
    ratio: createMultiple(new BigNumber(10).pow(new BigNumber(18 - decimals)).toNumber()),
    targetWeight: percentToWeight(targetWeight),
    vaultBalance: simpleToExactAmount(vaultBalance, decimals),
    status,
  };
};
