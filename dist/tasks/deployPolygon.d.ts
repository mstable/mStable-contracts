import "ts-node/register";
import "tsconfig-paths/register";
interface Bassets {
    name: string;
    symbol: string;
    decimals: number;
    integrator: string;
    initialMint: number;
}
export declare const mUsdBassets: Bassets[];
export {};
