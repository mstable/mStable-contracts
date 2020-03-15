/* eslint-disable import/prefer-default-export */
import { Address } from "../../types/common";

export class MainnetAccounts {
    // ETH token address
    public ETH: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    // Exchange Accounts
    public OKEX: Address = "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b";

    // All Native Tokens
    public allNativeTokens: Address[];

    public DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

    public GUSD: Address = "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd";

    public PAX: Address = "0x8E870D67F660D95d5be530380D0eC0bd388289E1";

    public TUSD: Address = "0x0000000000085d4780B73119b644AE5ecd22b376";

    public USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

    public USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

    public SUSD: Address = "0x57Ab1E02fEE23774580C119740129eAC7081e9D3";

    // AAVE aToken
    public allATokens: Address[];

    public aDAI: Address = "0xfC1E690f61EFd961294b3e1Ce3313fBD8aa4f85d";

    public aUSDC: Address = "0x9bA00D6856a4eDF4665BcA2C2309936572473B7E";

    public aSUSD: Address = "0x625aE63000f46200499120B906716420bd059240";

    public aTUSD: Address = "0x4DA9b813057D04BAef4e5800E36083717b4a0341";

    public aUSDT: Address = "0x71fc860F7D3A592A4a98740e39dB31d25db65ae8";

    constructor() {
        this.allNativeTokens = [
            this.DAI,
            this.GUSD,
            this.PAX,
            this.TUSD,
            this.USDC,
            this.USDT,
            this.SUSD,
        ];

        this.allNativeTokens = [this.aDAI, this.aUSDC, this.aSUSD, this.aTUSD, this.aUSDT];
    }
}
