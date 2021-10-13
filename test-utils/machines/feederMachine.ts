import { Signer } from "ethers"
import {
    AssetProxy__factory,
    FeederLogic,
    FeederLogic__factory,
    FeederPool,
    FeederPool__factory,
    FeederManager__factory,
    MockERC20,
    MockPlatformIntegration__factory,
    IPlatformIntegration,
    FeederManager,
    InterestValidator__factory,
    InterestValidator,
    MockATokenV2__factory,
    MockAaveV2__factory,
    Masset,
    MockERC20__factory,
    NonPeggedFeederPool__factory,
    RedemptionPriceSnapMock,
    RedemptionPriceSnapMock__factory,
} from "types/generated"
import { BN, minimum, simpleToExactAmount } from "@utils/math"
import { ratioScale, ZERO_ADDRESS, DEAD_ADDRESS, fullScale } from "@utils/constants"
import { Basset } from "@utils/mstable-objects"
import { StandardAccounts } from "./standardAccounts"
import { ActionDetails, BasketComposition } from "../../types/machines"
import { MassetMachine, MassetDetails } from "./mAssetMachine"

export interface FeederDetails {
    pool?: FeederPool
    logic?: FeederLogic
    manager?: FeederManager
    interestValidator?: InterestValidator
    mAsset?: MockERC20 & Masset
    fAsset?: MockERC20
    // [0] = mAsset
    // [1] = fAsset
    bAssets?: MockERC20[]
    pTokens?: Array<string>
    mAssetDetails?: MassetDetails
    redemptionPriceSnap?: RedemptionPriceSnapMock
}

export class FeederMachine {
    public sa: StandardAccounts

    public mAssetMachine: MassetMachine

    constructor(massetMachine: MassetMachine) {
        this.mAssetMachine = massetMachine
        this.sa = massetMachine.sa
    }

    public async initAccounts(accounts: Signer[]): Promise<FeederMachine> {
        this.sa = await new StandardAccounts().initAccounts(accounts)
        return this
    }

    public async deployFeeder(
        feederWeights: Array<BN | number> = [200, 200],
        mAssetWeights: Array<BN | number> = [2500, 2500, 2500, 2500],
        useLendingMarkets = false,
        useInterestValidator = false,
        use2dp = false,
        useRedemptionPrice = false,
    ): Promise<FeederDetails> {
        const mAssetDetails = await this.mAssetMachine.deployMasset(useLendingMarkets, false)
        // Mints 10k mAsset to begin with
        await this.mAssetMachine.seedWithWeightings(mAssetDetails, mAssetWeights)

        const fAsset = await this.mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", use2dp ? 2 : 18)
        const bAssets = [mAssetDetails.mAsset as MockERC20, fAsset]
        const feederLogic = await new FeederLogic__factory(this.sa.default.signer).deploy()
        const feederManager = await new FeederManager__factory(this.sa.default.signer).deploy()
        const linkedAddress = {
            "contracts/feeders/FeederLogic.sol:FeederLogic": feederLogic.address,
            "contracts/feeders/FeederManager.sol:FeederManager": feederManager.address,
        }
        let redemptionPriceSnap: RedemptionPriceSnapMock
        let feederPoolFactory;
        let impl;

        // - Deploy InterestValidator contract
        let interestValidator: InterestValidator
        if (useInterestValidator) {
            interestValidator = await new InterestValidator__factory(this.sa.default.signer).deploy(mAssetDetails.nexus.address)
            await mAssetDetails.nexus.setInterestValidator(interestValidator.address)
        }

        // - Add fAsset to lending markets
        const platformIntegration = new MockPlatformIntegration__factory(this.sa.governor.signer).attach(mAssetDetails.integrationAddress)
        const pTokens: string[] = []
        if (useLendingMarkets) {
            //  - Deploy mock aToken for the mAsset and fAsset
            const aTokenFactory = new MockATokenV2__factory(this.sa.default.signer)
            const mockATokenMasset = await aTokenFactory.deploy(mAssetDetails.aavePlatformAddress, mAssetDetails.mAsset.address)
            const mockATokenFasset = await aTokenFactory.deploy(mAssetDetails.aavePlatformAddress, fAsset.address)
            pTokens.push(mockATokenMasset.address, mockATokenFasset.address)
            // - Transfer some of the mAsset and fAsset supply to the mocked Aave
            await mAssetDetails.mAsset.transfer(mAssetDetails.aavePlatformAddress, (await mAssetDetails.mAsset.totalSupply()).div(1000))
            await fAsset.transfer(mAssetDetails.aavePlatformAddress, (await fAsset.totalSupply()).div(1000))

            // - Add mAsset and fAsset to the mocked Aave platform
            const mockAave = new MockAaveV2__factory(this.sa.default.signer).attach(mAssetDetails.aavePlatformAddress)
            await mockAave.addAToken(mockATokenMasset.address, mAssetDetails.mAsset.address)
            await mockAave.addAToken(mockATokenFasset.address, fAsset.address)

            // - Add mAsset and fAsset to the platform integration
            await platformIntegration.setPTokenAddress(mAssetDetails.mAsset.address, mockATokenMasset.address)
            await platformIntegration.setPTokenAddress(fAsset.address, mockATokenFasset.address)
        }

        // Deploy feeder pool
        if (useRedemptionPrice) {
            // - Deploy RedemptionPriceSnapMock contract
            redemptionPriceSnap = await new RedemptionPriceSnapMock__factory(this.sa.default.signer).deploy()
            let redemptionPriceSnapAddress = redemptionPriceSnap.address

            feederPoolFactory = NonPeggedFeederPool__factory;
            impl = await new feederPoolFactory(linkedAddress, this.sa.default.signer).deploy(
                mAssetDetails.nexus.address,
                mAssetDetails.mAsset.address,
                redemptionPriceSnapAddress,
            )
        }
        else {
            feederPoolFactory = FeederPool__factory;
            impl = await new feederPoolFactory(linkedAddress, this.sa.default.signer).deploy(
                mAssetDetails.nexus.address,
                mAssetDetails.mAsset.address,
            )
        }
        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable mBTC/bBTC Feeder",
            "bBTC fPool",
            {
                addr: mAssetDetails.mAsset.address,
                integrator: useLendingMarkets ? mAssetDetails.integrationAddress : ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            },
            {
                addr: fAsset.address,
                integrator: useLendingMarkets ? mAssetDetails.integrationAddress : ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            },
            mAssetDetails.bAssets.map((b) => b.address),
            {
                a: BN.from(300),
                limits: {
                    min: simpleToExactAmount(20, 16), // 3%
                    max: simpleToExactAmount(80, 16), // 97%
                },
            },
        ])
        // Deploy feeder pool proxy and call initialize on the feeder pool implementation
        const poolProxy = await new AssetProxy__factory(this.sa.default.signer).deploy(impl.address, DEAD_ADDRESS, data)
        // Link the feeder pool ABI to its proxy
        const pool = await new feederPoolFactory(linkedAddress, this.sa.default.signer).attach(poolProxy.address)

        // - Add feeder pool to the platform integration whitelist
        if (useLendingMarkets) {
            await platformIntegration.addWhitelist([pool.address])
        }

        if (feederWeights?.length > 0) {
            const approvals = await Promise.all(
                bAssets.map((b, i) => this.mAssetMachine.approveMasset(b, pool, feederWeights[i], this.sa.default.signer)),
            )
            await pool.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                0,
                this.sa.default.address,
            )
        }
        return {
            pool,
            logic: feederLogic,
            manager: feederManager,
            interestValidator,
            mAsset: mAssetDetails.mAsset,
            fAsset,
            bAssets,
            pTokens,
            mAssetDetails,
            redemptionPriceSnap,
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
            bArrays.map((b) => MockERC20__factory.connect(b.addr, this.sa.default.signer)),
        )
        const integrators = await Promise.all(
            bArrays.map((b) =>
                b.integratorAddr === ZERO_ADDRESS
                    ? null
                    : (MockPlatformIntegration__factory.connect(
                          b.integratorAddr,
                          this.sa.default.signer,
                      ) as unknown as IPlatformIntegration),
            ),
        )
        return bArrays.map((b, i) => ({
            ...b,
            contract: bAssetContracts[i],
            integrator: integrators[i],
        }))
    }

    // Gets the fAsset, mAsset or mpAsset
    public async getAsset(
        feederDetails: FeederDetails,
        assetAddress: string,
    ): Promise<Basset & { isMpAsset: boolean; feederPoolOrMassetContract: MockERC20 }> {
        let asset
        let isMpAsset = false
        // If a feeder asset or mStable asset
        if (assetAddress === feederDetails.fAsset.address || assetAddress === feederDetails.mAsset.address) {
            asset = await feederDetails.pool.getBasset(assetAddress)
            // If a main pool asset
        } else if (feederDetails.mAssetDetails.bAssets.map((b) => b.address).includes(assetAddress)) {
            asset = await feederDetails.mAsset.getBasset(assetAddress)
            isMpAsset = true
        } else {
            throw new Error(`Asset with address ${assetAddress} is not a fAsset, mAsset or mpAsset`)
        }
        const assetContract = MockERC20__factory.connect(asset.personal.addr, this.sa.default.signer)
        const integrator =
            asset.personal.integrator === ZERO_ADDRESS
                ? null
                : ((await new MockPlatformIntegration__factory(this.sa.default.signer).attach(
                      asset.personal.integrator,
                  )) as unknown as IPlatformIntegration)
        return {
            addr: asset.personal.addr,
            status: asset.personal.status,
            isTransferFeeCharged: asset.personal.hasTxFee,
            ratio: isMpAsset ? BN.from(asset.bData.ratio) : BN.from(asset.vaultData.ratio),
            vaultBalance: isMpAsset ? BN.from(asset.bData.vaultBalance) : BN.from(asset.vaultData.vaultBalance),
            integratorAddr: asset.personal.integrator,
            contract: assetContract,
            pToken: integrator ? await integrator.callStatic["bAssetToPToken(address)"](asset.personal.addr) : null,
            integrator,
            isMpAsset,
            feederPoolOrMassetContract: isMpAsset ? feederDetails.mAsset : feederDetails.pool,
        }
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
        const currentVaultUnits = bAssets.map((b) => BN.from(b.vaultBalance).mul(BN.from(b.ratio)).div(ratioScale))
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
        asset: MockERC20,
        feeder: string,
        assetQuantity: number | BN | string,
        sender: Signer = this.sa.default.signer,
        inputIsBaseUnits = false,
    ): Promise<BN> {
        const assetDecimals = await asset.decimals()
        const approvalAmount: BN = inputIsBaseUnits ? BN.from(assetQuantity) : simpleToExactAmount(assetQuantity, assetDecimals)
        await asset.connect(sender).approve(feeder, approvalAmount)
        return approvalAmount
    }

    public static async getPlatformInteraction(
        pool: FeederPool,
        type: "deposit" | "withdrawal",
        amount: BN,
        bAsset: Basset,
    ): Promise<ActionDetails> {
        const hasIntegrator = bAsset.integratorAddr === ZERO_ADDRESS
        const integratorBalBefore = await bAsset.contract.balanceOf(bAsset.integrator ? bAsset.integratorAddr : pool.address)
        if (hasIntegrator) {
            return {
                hasLendingMarket: false,
                expectInteraction: false,
                rawBalance: type === "deposit" ? integratorBalBefore.add(amount) : integratorBalBefore.sub(amount),
            }
        }
        const hasTxFee = bAsset.isTransferFeeCharged
        if (hasTxFee) {
            return {
                hasLendingMarket: true,
                expectInteraction: true,
                amount,
                rawBalance: BN.from(0),
            }
        }
        const totalSupply = await pool.totalSupply()
        const { cacheSize, pendingFees } = await pool.data()
        const maxC = totalSupply.add(pendingFees).mul(ratioScale).div(BN.from(bAsset.ratio)).mul(cacheSize).div(fullScale)
        const newSum = BN.from(integratorBalBefore).add(amount)
        const expectInteraction = type === "deposit" ? newSum.gte(maxC) : amount.gt(BN.from(integratorBalBefore))
        return {
            hasLendingMarket: true,
            expectInteraction,
            amount:
                type === "deposit"
                    ? newSum.sub(maxC.div(2))
                    : minimum(
                          maxC.div(2).add(amount).sub(BN.from(integratorBalBefore)),
                          BN.from(bAsset.vaultBalance).sub(BN.from(integratorBalBefore)),
                      ),
            rawBalance:
                type === "deposit"
                    ? expectInteraction
                        ? maxC.div(2)
                        : newSum
                    : expectInteraction
                    ? minimum(maxC.div(2), BN.from(bAsset.vaultBalance).sub(amount))
                    : BN.from(integratorBalBefore).sub(amount),
        }
    }
}
