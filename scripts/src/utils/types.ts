import { Basset } from "@utils/mstable-objects";
import { ERC20Instance, ERC20MockInstance } from "types/generated";

export type BassetInstance = ERC20Instance | ERC20MockInstance;

// export type OrderedBassets = [
//     USDTInstance,
//     USDCInstance,
//     TUSDInstance,
//     DAIInstance,
//     SUSDInstance,
//     GUSDInstance,
//     PAXInstance,
// ];

export interface BassetWithDecimals extends Basset {
    decimals: number;
}
