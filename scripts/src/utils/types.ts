import { Basset } from "@utils/mstable-objects";
import { ERC20Instance, MockERC20Instance } from "types/generated";

export type BassetInstance = ERC20Instance | MockERC20Instance;

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
