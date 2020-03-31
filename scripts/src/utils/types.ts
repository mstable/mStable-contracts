import { Basset } from "@utils/mstable-objects";
import { ERC20Instance, MockERC20Instance, ERC20DetailedInstance } from "types/generated";

export type BassetInstance = ERC20DetailedInstance;

export interface BassetWithDecimals extends Basset {
    decimals: BN;
}
