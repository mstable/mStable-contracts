/* eslint-disable class-methods-use-this */
/* eslint-disable no-nested-ternary */

import { Signer } from "ethers"
import { ethers } from "hardhat"
import {
    FeederValidator__factory,
    MockInvariantValidator__factory,
    AssetProxy__factory,
    MockNexus__factory,
    ExposedMasset,
    ExposedMasset__factory,
    Masset,
    InvariantValidator,
    MockERC20,
    DelayedProxyAdmin,
    MockInitializableToken,
    MockAaveV2__factory,
    MockATokenV2__factory,
    MockPlatformIntegration,
    MockPlatformIntegration__factory,
    IPlatformIntegration,
    MockInitializableToken__factory,
    MockInitializableTokenWithFee__factory,
    Manager,
    FeederValidator,
    FeederPool,
    FeederPool__factory,
} from "types/generated"
import { BN, minimum, simpleToExactAmount } from "@utils/math"
import { fullScale, MainnetAccounts, ratioScale, ZERO_ADDRESS, DEAD_ADDRESS } from "@utils/constants"
import { Basset } from "@utils/mstable-objects"
import { StandardAccounts } from "./standardAccounts"
import { ActionDetails, BasketComposition, BassetIntegrationDetails } from "../../types/machines"
import { MassetMachine, MassetDetails } from "./mAssetMachine"

export interface FeederDetails {
    pool?: FeederPool
    validator?: FeederValidator
    mAsset?: MockERC20
    fAsset?: MockERC20
    // [0] = mAsset
    // [1] = fAsset
    bAssets?: MockERC20[]
    mAssetDetails?: MassetDetails
}

export class FeederMachine {
    public sa: StandardAccounts

    public ma: MainnetAccounts

    public mAssetMachine: MassetMachine

    constructor(massetMachine: MassetMachine) {
        this.mAssetMachine = massetMachine
        this.sa = massetMachine.sa
    }

    public async initAccounts(accounts: Signer[]): Promise<FeederMachine> {
        this.sa = await new StandardAccounts().initAccounts(accounts)
        return this
    }

    public async deployFeeder(seedBasket = true): Promise<FeederDetails> {
        const mAssetDetails = await this.mAssetMachine.deployMasset(false, false, false)
        // Mints 10k mAsset to begin with
        await this.mAssetMachine.seedWithWeightings(mAssetDetails, [2500, 2500, 2500, 2500])

        const bBtc = await this.mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", 18)
        const bAssets = [mAssetDetails.mAsset as MockERC20, bBtc]
        const validator = await new FeederValidator__factory(this.sa.default.signer).deploy()
        const linkedAddress = {
            __$1a38b0db2bd175b310a9a3f8697d44eb75$__: mAssetDetails.managerLib.address,
            __$ba0f40aa073b093068e86d426c6136c22f$__: validator.address,
        }
        console.log("i")
        const impl = await new FeederPool__factory(linkedAddress, this.sa.default.signer).deploy(DEAD_ADDRESS, mAssetDetails.mAsset.address)
        console.log("ii")
        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable mBTC/bBTC Feeder",
            "bBTC fPool",
            {
                addr: mAssetDetails.mAsset.address,
                integrator: ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            },
            {
                addr: bBtc.address,
                integrator: ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            },
            mAssetDetails.bAssets.map((b) => b.address),
            {
                a: simpleToExactAmount(1, 2),
                limits: {
                    min: simpleToExactAmount(3, 16),
                    max: simpleToExactAmount(97, 16),
                },
            },
        ])
        console.log("iii")
        const poolProxy = await new AssetProxy__factory(this.sa.default.signer).deploy(impl.address, DEAD_ADDRESS, data)
        console.log("iv")
        const pool = await new FeederPool__factory(linkedAddress, this.sa.default.signer).attach(poolProxy.address)
        console.log("v")
        const a = await pool.getConfig()
        console.log(a)
        if (seedBasket) {
            const approvals = await Promise.all(bAssets.map((b) => this.mAssetMachine.approveMasset(b, pool, 200, this.sa.default.signer)))
            console.log("vi")
            await pool.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                0,
                this.sa.default.address,
            )
        }
        return {
            pool,
            validator,
            mAsset: mAssetDetails.mAsset as MockERC20,
            fAsset: bBtc,
            bAssets,
            mAssetDetails,
        }
    }

    public async getBassets(feederDetails: FeederDetails): Promise<Basset[]> {
        const [personal, data] = await feederDetails.pool.getBassets()
        const bArrays: Array<Basset> = personal.map((b, i) => {
            const d = data[i]
            return {
                addr: b.addr,
                status: b.status,
                isTransferFeeCharged: b.hasTxFee,
                ratio: BN.from(d.ratio),
                vaultBalance: BN.from(d.vaultBalance),
                integratorAddr: b.integrator,
            }
        })
        const bAssetContracts: MockERC20[] = await Promise.all(
            bArrays.map((b) => ethers.getContractAt("MockERC20", b.addr, this.sa.default.signer) as Promise<MockERC20>),
        )
        const integrators = (await Promise.all(
            bArrays.map((b) =>
                b.integratorAddr === ZERO_ADDRESS
                    ? null
                    : ethers.getContractAt("MockPlatformIntegration", b.integratorAddr, this.sa.default.signer),
            ),
        )) as Array<IPlatformIntegration>
        return bArrays.map((b, i) => ({
            ...b,
            contract: bAssetContracts[i],
            integrator: integrators[i],
        }))
    }

    public async getBasketComposition(feederDetails: FeederDetails): Promise<BasketComposition> {
        // raw bAsset data
        const bAssets = await this.getBassets(feederDetails)

        // total supply of mAsset
        const supply = await feederDetails.pool.totalSupply()
        // get actual balance of each bAsset
        const rawBalances = await Promise.all(
            bAssets.map((b) =>
                b.integrator ? b.contract.balanceOf(b.integrator.address) : b.contract.balanceOf(feederDetails.pool.address),
            ),
        )
        const platformBalances = await Promise.all(
            bAssets.map((b) => (b.integrator ? b.integrator.callStatic.checkBalance(b.addr) : BN.from(0))),
        )

        const balances = rawBalances.map((b, i) => b.add(platformBalances[i]))
        // get overweight
        const currentVaultUnits = bAssets.map((b) =>
            BN.from(b.vaultBalance)
                .mul(BN.from(b.ratio))
                .div(ratioScale),
        )
        // get total amount
        const sumOfBassets = currentVaultUnits.reduce((p, c) => p.add(c), BN.from(0))
        return {
            bAssets: bAssets.map((b, i) => ({
                ...b,
                address: b.addr,
                mAssetUnits: currentVaultUnits[i],
                actualBalance: balances[i],
                rawBalance: rawBalances[i],
                platformBalance: platformBalances[i],
            })),
            totalSupply: supply,
            surplus: BN.from(0),
            sumOfBassets,
            failed: false,
            undergoingRecol: false,
        }
    }

    public async approveFeeder(
        bAsset: MockERC20,
        feeder: string,
        fullMassetUnits: number | BN | string,
        sender: Signer = this.sa.default.signer,
        inputIsBaseUnits = false,
    ): Promise<BN> {
        const bAssetDecimals = await bAsset.decimals()
        const approvalAmount: BN = inputIsBaseUnits ? BN.from(fullMassetUnits) : simpleToExactAmount(fullMassetUnits, bAssetDecimals)
        await bAsset.connect(sender).approve(feeder, approvalAmount)
        return approvalAmount
    }
}
