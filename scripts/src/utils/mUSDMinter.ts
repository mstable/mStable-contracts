import { applyRatioMassetToBasset, exactToSimpleAmount, simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import * as t from "types/generated";;
import { BassetInstance, BassetWithDecimals } from "./types";

import TransactionDetails = Truffle.TransactionDetails;

// eslint-disable-next-line import/prefer-default-export
export class MUSDMinter {
    constructor(
        public readonly mUSD: t.MassetInstance,
        public readonly basketManager: t.BasketManagerInstance,
        public readonly bassets: Array<BassetInstance>,
    ) {}

    public async approve(
        bassets = this.bassetAddresses,
        amount: BN,
        txDetails: TransactionDetails,
    ) {
        const decimals = await this.getDecimals(bassets);
        return Promise.all(
            bassets.map((address, index) =>
                this.getBassetByAddress(address).approve(
                    this.mUSD.address,
                    simpleToExactAmount(amount, decimals[index]),
                    txDetails,
                ),
            ),
        );
    }

    public async approveAllBassets(amount: BN, txDetails: TransactionDetails) {
        return this.approve(undefined, amount, txDetails);
    }

    public async mint(
        bassets = this.bassetAddresses,
        quantities: number[],
        musdRecipient: string,
        txDetails: TransactionDetails,
    ) {
        if (bassets.length !== quantities.length) {
            throw new Error("Expected the same number of bassets and quantities");
        }

        const data = await this.getBassetsData(bassets);
        const decimalQuantities = quantities.map((amount, index) =>
            simpleToExactAmount(amount, data[index].decimals),
        );

        return this.mUSD.mintMulti(bassets, decimalQuantities, musdRecipient, txDetails);
    }

    public async mintAllBassets(
        mintInput: BN,
        musdRecipient: string,
        txDetails: TransactionDetails,
    ) {
        const quantities = await this.calcOptimalBassetQuantitiesForMint(mintInput);
        return this.mUSD.mintMulti(this.bassetAddresses, quantities, musdRecipient, txDetails);
    }

    public async getMUSDBalance(account: string) {
        const decimals = await this.mUSD.decimals();
        const amount = await this.mUSD.balanceOf(account);
        return exactToSimpleAmount(amount, decimals);
    }

    private async getBassetsData(bassets = this.bassetAddresses) {
        const data = await Promise.all(
            bassets.map(async (b) => {
                const x = await this.basketManager.getBasset(b);
                const d = await this.getBassetByAddress(b).decimals();
                return {
                    ...x,
                    status: parseInt(x.status.toString(), 10) as BassetStatus,
                    decimals: d,
                };
            }),
        );

        return data as BassetWithDecimals[];
    }

    private async calcOptimalBassetQuantitiesForMint(mintInput: BN) {
        const massetDecimals = await this.mUSD.decimals();
        const mintInputExact = simpleToExactAmount(mintInput, massetDecimals.toNumber());
        const data = await this.getBassetsData(this.bassetAddresses);
        return data.map(({ maxWeight, ratio }) => {
            // 1e18 Massets
            // 1e18 * ratioScale = 1e26
            // if Ratio == 1e8 then its straight up
            // if Ratio == 1e12 then that means decimals = 4
            // maxWeight == 40% == 40e16
            // convertExactToSimple divides by 1e18
            // this creates an exact percentage amount
            const relativeUnitsToMint = exactToSimpleAmount(
                mintInputExact.mul(new BN(maxWeight)),
                18,
            );
            return applyRatioMassetToBasset(relativeUnitsToMint, ratio);
        });
    }

    private async getDecimals(bassets = this.bassetAddresses): Promise<number[]> {
        const decimals = await Promise.all(
            bassets.map((address) => this.getBassetByAddress(address).decimals()),
        );
        return decimals.map((bn) => bn.toNumber());
    }

    private getBassetByAddress(address: string): BassetInstance {
        const basset = this.bassets.find((b) => b.address === address);
        if (!basset) {
            throw new Error(`Basset with address ${address} not found`);
        }
        return basset;
    }

    public get bassetAddresses(): string[] {
        return this.bassets.map((basset) => basset.address);
    }
}
