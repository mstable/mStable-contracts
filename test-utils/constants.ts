import { aToH, BigNumber } from "./tools";

/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should confirm to fixed on chain vars
 */

export const percentScale = new BigNumber("1e16");
export const ratioScale = new BigNumber("1e8");
export const expScale = new BigNumber("1e18");

export const DEFAULT_DECIMALS = new BigNumber("18");
export const DEFAULT_SUPPLY = new BigNumber("1e23");

export const MASSET_FACTORY_BYTES = aToH("MassetFactoryV1");

export const ZERO_ADDRESS: string = "0x0000000000000000000000000000000000000000";
export const ADDRESS_1: string = "0xcd959e71449425f6e4ac814b7f5aebde93012e24";
export const ADDRESS_2: string = "0xcd959e71449425f6e4ac814b7f5aebde93012e24";
export const ADDRESS_3: string = "0xc257274276a4e539741ca11b590b9447b26a8051";
