import { aToH, BN } from "./tools";
import { Address } from "types/common";

/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should confirm to fixed on chain vars
 */

export const percentScale = new BN(10).pow(new BN(16));
export const ratioScale = new BN(10).pow(new BN(8));
export const expScale: BN = new BN(10).pow(new BN(18));

export const DEFAULT_DECIMALS = new BN("18");
export const DEFAULT_SUPPLY = new BN(10).pow(new BN(29));

export const MASSET_FACTORY_BYTES = aToH("MassetFactoryV1");

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ADDRESS_1 = "0xcd959e71449425f6e4ac814b7f5aebde93012e24";
export const ADDRESS_2 = "0xcd959e71449425f6e4ac814b7f5aebde93012e24";
export const ADDRESS_3 = "0xc257274276a4e539741ca11b590b9447b26a8051";

export const ZERO = new BN(0);
export const ONE_DAY = new BN(60 * 60 * 24);
export const TEN_DAYS = new BN(60 * 60 * 24 * 10);
export const ONE_WEEK = new BN(60 * 60 * 24 * 7);

export class MainnetAccounts {
    // Exchange Accounts
    private okex: Address = "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b";
    private binance: Address = "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE";
    public FUND_SOURCES = {
        dai: this.okex,
        usdc: this.binance,
        tusd: "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3",
        usdt: this.binance,
    };

    // All Native Tokens
    public DAI: Address = "0x6b175474e89094c44da98b954eedeac495271d0f";
    public GUSD: Address = "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd";
    public PAX: Address = "0x8E870D67F660D95d5be530380D0eC0bd388289E1";
    public TUSD: Address = "0x0000000000085d4780B73119b644AE5ecd22b376";
    public USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    public USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
    public SUSD: Address = "0x57Ab1E02fEE23774580C119740129eAC7081e9D3";
    public allNativeTokens: Address[] = [
        this.DAI,
        this.GUSD,
        this.PAX,
        this.TUSD,
        this.USDC,
        this.USDT,
        this.SUSD,
    ];

    // AAVE
    public aavePlatform: Address = "0x24a42fD28C976A61Df5D00D0599C34c4f90748c8";
    public aDAI: Address = "0xfC1E690f61EFd961294b3e1Ce3313fBD8aa4f85d";
    public aUSDC: Address = "0x9bA00D6856a4eDF4665BcA2C2309936572473B7E";
    public aSUSD: Address = "0x625aE63000f46200499120B906716420bd059240";
    public aTUSD: Address = "0x4DA9b813057D04BAef4e5800E36083717b4a0341";
    public aUSDT: Address = "0x71fc860F7D3A592A4a98740e39dB31d25db65ae8";
    public allATokens: Address[] = [this.aDAI, this.aUSDC, this.aSUSD, this.aTUSD, this.aUSDT];

    // Compound cTokens
    public cDAI: Address = "0x5d3a536e4d6dbd6114cc1ead35777bab948e3643";
    public cUSDC: Address = "0x39aa39c021dfbae8fac545936693ac917d5e7563";
    public allCTokens: Address[] = [this.cDAI, this.cUSDC];
}
