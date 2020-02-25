import { Basset } from "@utils/mstable-objects";
import {
    DAIInstance,
    GUSDInstance,
    PAXInstance,
    SUSDInstance,
    TUSDInstance,
    USDCInstance,
    USDTInstance,
} from "types/generated";

export type BassetInstance =
    | DAIInstance
    | GUSDInstance
    | PAXInstance
    | SUSDInstance
    | TUSDInstance
    | USDCInstance
    | USDTInstance;

export type OrderedBassets = [
    USDTInstance,
    USDCInstance,
    TUSDInstance,
    DAIInstance,
    SUSDInstance,
    GUSDInstance,
    PAXInstance,
];

export interface BassetWithDecimals extends Basset {
    decimals: number;
}
