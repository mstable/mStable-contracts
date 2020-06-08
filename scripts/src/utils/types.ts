import { Basset } from "@utils/mstable-objects";
import * as t from "types/generated";

export type BassetInstance = t.Erc20DetailedInstance;

export interface BassetWithDecimals extends Basset {
    decimals: BN;
}
