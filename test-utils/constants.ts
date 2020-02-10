import { aToH, BN } from "./tools";

/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should confirm to fixed on chain vars
 */

export const percentScale = new BN(10).pow(new BN(16));
export const ratioScale = new BN(10).pow(new BN(8));
export const expScale = new BN(10).pow(new BN(18));

export const DEFAULT_DECIMALS = new BN("18");
export const DEFAULT_SUPPLY = new BN(10).pow(new BN(23));

export const MASSET_FACTORY_BYTES = aToH("MassetFactoryV1");

export const ZERO_ADDRESS: string = "0x0000000000000000000000000000000000000000";
export const ADDRESS_1: string = "0xcd959e71449425f6e4ac814b7f5aebde93012e24";
export const ADDRESS_2: string = "0xcd959e71449425f6e4ac814b7f5aebde93012e24";
export const ADDRESS_3: string = "0xc257274276a4e539741ca11b590b9447b26a8051";
