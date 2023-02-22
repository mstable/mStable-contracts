import {
    Account,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    FeederManagerV2__factory,
    FeederPoolAlusd__factory,
    FeederPoolV2,
    FeederPoolV2__factory,
    FeiFeederPool__factory,
    IERC20Metadata__factory,
    IERC20__factory,
    InterestValidator,
    InterestValidator__factory,
    Nexus,
    Nexus__factory,
    NonPeggedFeederPoolV2__factory,
} from "types"
import { network } from "hardhat"
import { impersonateAccount } from "@utils/fork"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { alUSD, BUSD, cyMUSD, DAI, deployContract, FEI, GUSD, mUSD, RAI, sUSD, Token, USDC, USDT } from "tasks/utils"
import { expect } from "chai"
import { increaseTime } from "@utils/time"
import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { formatUnits } from "ethers/lib/utils"
import { simpleToExactAmount } from "@utils/math"

const musdWhaleAddress = "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43"
const gusdWhaleAddress = "0x22FFDA6813f4F34C520bf36E5Ea01167bC9DF159"
const gusdFpWhaleAddress = "0x0fc4b69958CB2Fa320a96d54168b89953a953FBF" // only 239
const busdWhaleAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC" // Binance 8
const busdFpWhaleAddress = "0xF9E22E7B6deaE675e3063880567B369C384CD3B9" // only 1,700
const alusdWhaleAddress = "0xFa0c409E4f88807a96Cced2aCCF116cC1649c425"
const alusdFpWhaleAddress = "0x9E90d6Fe95ee0bb754261eE3FC3d8a9c11e97a8E" // only 24
const raiWhaleAddress = "0x86f6ff8479c69E0cdEa641796b0D3bB1D40761Db"
const raiFpWhaleAddress = "0xA3C1F84fcBedc93aEc401120206b48BEa951D8d0" // 1,400
const feiWhaleAddress = "0x3A24fea1509e1BaeB2D2A7C819A191AA441825ea"
const feiFpWhaleAddress = "0xdbBb8F8EFF9e4d52D1F18070f098b5AB4c2eAD04" // only 24

const gusdIronBankIntegrationAddress = "0xaF007D4ec9a13116035a2131EA1C9bc0B751E3cf"

context("Feeder Pools shutdown", async () => {
    let ops: Account
    let governor: Account
    let nexus: Nexus
    let delayedProxyAdmin: DelayedProxyAdmin
    let feederPoolValidator: InterestValidator
    let libraryAddress

    const deployFeederPool = async (asset: Token, feederPool: FeederPoolV2) => {
        const totalSupplyBefore = await feederPool.totalSupply()
        // Deploy new Feeder Pool implementation
        const feederPoolImpl = await deployContract(new FeederPoolV2__factory(libraryAddress, ops.signer), `${asset.symbol} FeederPool`, [
            nexus.address,
            mUSD.address,
        ])
        // Propose upgrade of Feeder Pool
        await delayedProxyAdmin.proposeUpgrade(asset.feederPool, feederPoolImpl.address, "0x")
        // Accept upgrade after 1 week
        await increaseTime(ONE_WEEK)
        await delayedProxyAdmin.acceptUpgradeRequest(asset.feederPool)

        // Test balances have not changed
        expect(await feederPool.totalSupply(), "total supply").to.eq(totalSupplyBefore)
    }
    const assertBalances = async (bAssetIndex: number, fAsset: Token, bAssetsBefore, bAssetsAfter, migrateMusd: boolean) => {
        const bAssetAddress = migrateMusd ? mUSD.address : fAsset.address

        expect(bAssetsAfter.vaultData[bAssetIndex].vaultBalance, `${bAssetIndex} vault balance`).to.eq(
            bAssetsBefore.vaultData[bAssetIndex].vaultBalance,
        )
        expect(bAssetsAfter.vaultData[bAssetIndex].ratio, `${fAsset.symbol} ratio`).to.eq(bAssetsBefore.vaultData[bAssetIndex].ratio)
        expect(bAssetsAfter[0][bAssetIndex].addr, `${fAsset.symbol} addr`).to.eq(bAssetAddress)
        expect(bAssetsAfter[0][bAssetIndex].integrator, `${fAsset.symbol} integrator`).to.eq(ZERO_ADDRESS)
        expect(bAssetsAfter[0][bAssetIndex].hasTxFee, `${fAsset.symbol} hasTxFee`).to.eq(false)
        expect(bAssetsAfter[0][bAssetIndex].status, `${fAsset.symbol} status`).to.eq(bAssetsBefore[0][bAssetIndex].status)

        // No more a tokens in the integrator contract
        // For mUSD in BUSD, check there is no mUSD left in the integrator
        const liquidityTokenAddress = migrateMusd ? mUSD.address : fAsset.liquidityProvider
        const liquidityAsset = IERC20__factory.connect(liquidityTokenAddress, ops.signer)
        expect(await liquidityAsset.balanceOf(fAsset.integrator), `${fAsset.symbol} integrator liquidity`).to.eq(0)

        // bAssets are now in the Feeder Pool
        const bAsset = IERC20Metadata__factory.connect(bAssetAddress, ops.signer)
        const balance = await bAsset.balanceOf(fAsset.feederPool)
        expect(balance, `${fAsset.symbol} bAsset cache`).to.gte(bAssetsBefore.vaultData[bAssetIndex].vaultBalance)
        // Are there extra bAssets in the mAsset compared to the vaultBalance?
        const balDiff = balance.sub(bAssetsBefore.vaultData[bAssetIndex].vaultBalance)
        const balDiffPercent = balDiff.mul(10000000000).div(bAssetsBefore.vaultData[bAssetIndex].vaultBalance)
        console.log(`${fAsset.symbol} balance diff: ${formatUnits(balDiff, fAsset.decimals)} (${formatUnits(balDiffPercent, 8)}%)`)
    }
    const migrateFasset = async (fAsset: Token, migrateMusd: boolean) => {
        console.log(`feeder pool ${fAsset.feederPool}`)
        const feederPool = FeederPoolV2__factory.connect(fAsset.feederPool, ops.signer)

        await feederPoolValidator.collectAndValidateInterest([fAsset.feederPool])

        const totalSupplyBefore = await feederPool.totalSupply()
        const bAssetsBefore = await feederPool.getBassets()

        // migrate feeder pool asset from Aave
        if (migrateMusd) {
            await feederPool.connect(governor.signer).migrateBassets([fAsset.address, mUSD.address], ZERO_ADDRESS)
        } else {
            await feederPool.connect(governor.signer).migrateBassets([fAsset.address], ZERO_ADDRESS)
        }

        expect(await feederPool.totalSupply(), "total supply").to.eq(totalSupplyBefore)

        const bAssetsAfter = await feederPool.getBassets()
        if (migrateMusd) {
            await assertBalances(0, fAsset, bAssetsBefore, bAssetsAfter, true)
        }
        await assertBalances(1, fAsset, bAssetsBefore, bAssetsAfter, false)
    }
    // can still mint, swap and redeem
    const assertSwap = async (test: {
        feederPoolAddress: string
        fromAsset: Token
        toAsset: Token
        amount: number
        whaleAddress: string
    }) => {
        const { feederPoolAddress, fromAsset, toAsset, amount, whaleAddress } = test

        const whale = await impersonateAccount(whaleAddress, false)
        const feederPool = FeederPoolV2__factory.connect(feederPoolAddress, whale.signer)

        const { vaultData: dataBefore } = await feederPool.getBasset(fromAsset.address)

        const swapAmount = simpleToExactAmount(amount, fromAsset.decimals)
        const swapAsset = IERC20__factory.connect(fromAsset.address, whale.signer)
        await swapAsset.approve(feederPool.address, swapAmount)

        const tx = await feederPool.connect(whale.signer).swap(fromAsset.address, toAsset.address, swapAmount, 0, whale.address)
        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "Swapped")
        expect(event.args?.fee).to.eq(0)

        const { vaultData: dataAfter } = await feederPool.getBasset(fromAsset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(swapAmount))
    }
    const assertMint = async (test: { asset: Token; amount: number; feederPoolAddress: string; whaleAddress: string }) => {
        const { asset, amount, feederPoolAddress, whaleAddress } = test

        const whale = await impersonateAccount(whaleAddress, false)
        const feederPool = FeederPoolV2__factory.connect(feederPoolAddress, whale.signer)

        const { vaultData: dataBefore } = await feederPool.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const assetContract = IERC20__factory.connect(asset.address, whale.signer)
        await assetContract.approve(feederPool.address, amountScaled)

        await feederPool.mint(asset.address, amountScaled, 0, whale.address)

        const { vaultData: dataAfter } = await feederPool.getBasset(asset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(amountScaled))
    }
    const assertRedeemExact = async (test: { asset: Token; amount: number; feederPoolAddress: string; whaleAddress: string }) => {
        const { asset, amount, feederPoolAddress, whaleAddress } = test

        const whale = await impersonateAccount(whaleAddress, true)
        const feederPool = FeederPoolV2__factory.connect(feederPoolAddress, whale.signer)

        const { vaultData: dataBefore } = await feederPool.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const maxFpTokens =
            asset.symbol === "RAI"
                ? simpleToExactAmount(amount, mUSD.decimals).mul(3)
                : simpleToExactAmount(amount, mUSD.decimals).mul(12).div(10)

        await feederPool.redeemExactBassets([asset.address], [amountScaled], maxFpTokens, whale.address)

        const { vaultData: dataAfter } = await feederPool.getBasset(asset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.sub(amountScaled))
    }
    const setFees = async (asset: Token) => {
        const feederPool = FeederPoolV2__factory.connect(asset.feederPool, ops.signer)
        await feederPool.connect(governor.signer).setFees(0, 0, 0)
        const data = await feederPool.data()
        expect(await data.swapFee, "swap fee").to.eq(0)
        expect(await data.redemptionFee, "redemption fee").to.eq(0)
        expect(await data.govFee, "gov fee").to.eq(0)
    }
    const setWeights = async (asset: Token) => {
        const feederPool = FeederPoolV2__factory.connect(asset.feederPool, ops.signer)
        const min = simpleToExactAmount(5, 16) // 5%
        const max = simpleToExactAmount(95, 17) // 95%
        await feederPool.connect(governor.signer).setWeightLimits(min, max)
        const data = await feederPool.data()
        expect(await data.weightLimits.min, "min weight").to.eq(min)
        expect(await data.weightLimits.max, "max weight").to.eq(max)
    }

    const runSetup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })
        ops = await impersonateAccount(resolveAddress("OperationsSigner"))
        governor = await impersonateAccount(resolveAddress("Governor"))

        nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor.signer)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor.signer)

        feederPoolValidator = InterestValidator__factory.connect(resolveAddress("FeederInterestValidator"), ops.signer)
    }

    before("reset block number", async () => {
        await runSetup(16610000)
    })
    it("deploy new Feeder Pool Manager library", async () => {
        const managerLib = await deployContract(new FeederManagerV2__factory(ops.signer), "FeederManagerV2")
        libraryAddress = {
            "contracts/feeders/legacy/gusd.sol:FeederManagerV2": managerLib.address,
            "contracts/feeders/legacy/gusd.sol:FeederLogic": resolveAddress("FeederLogic"),
        }
    })
    const testFeederPools = [
        { asset: GUSD, migrateMusd: false },
        { asset: BUSD, migrateMusd: true },
        { asset: alUSD, migrateMusd: false },
        { asset: RAI, migrateMusd: false },
        { asset: FEI, migrateMusd: false },
    ]
    describe("deploy and upgrade", () => {
        testFeederPools.forEach((test) => {
            it(`${test.asset.symbol}`, async () => {
                let factory
                if (test.asset.symbol === "alUSD") {
                    factory = FeederPoolAlusd__factory.connect(test.asset.feederPool, ops.signer)
                } else if (test.asset.symbol === "RAI") {
                    factory = NonPeggedFeederPoolV2__factory.connect(test.asset.feederPool, ops.signer)
                } else if (test.asset.symbol === "FAI") {
                    factory = FeiFeederPool__factory.connect(test.asset.feederPool, ops.signer)
                } else {
                    factory = FeederPoolV2__factory.connect(test.asset.feederPool, ops.signer)
                }
                await deployFeederPool(test.asset, factory)
            })
        })
    })
    describe("migrate fAssets", () => {
        testFeederPools.forEach((test) => {
            it(`${test.asset.symbol}`, async () => {
                await migrateFasset(test.asset, test.migrateMusd)
            })
        })
    })
    describe("set fees to zero", () => {
        testFeederPools.forEach((test) => {
            it(`${test.asset.symbol}`, async () => {
                await setFees(test.asset)
            })
        })
    })
    describe("set weights to 5% and 95%", () => {
        testFeederPools.forEach((test) => {
            it(`${test.asset.symbol}`, async () => {
                await setWeights(test.asset)
            })
        })
    })
    describe("cache mUSD liquidity in Iron Bank for GUSD Feeder Pool", () => {
        // need to put in here so it runs after the other describe blocks
        it("successfully withdraw all liquidity", async () => {
            const feederPool = FeederPoolV2__factory.connect(GUSD.feederPool, governor.signer)
            const musdToken = IERC20__factory.connect(mUSD.address, ops.signer)
            const beforeMusdIntegrator = await musdToken.balanceOf(gusdIronBankIntegrationAddress)
            const withdrawAmount = await musdToken.balanceOf(cyMUSD.address)
            console.log(`${withdrawAmount} mUSD liquidity in cymUSD`)

            await feederPool.cachePlatformIntegration(mUSD.address, withdrawAmount)

            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "integrator mUSD after").to.eq(
                beforeMusdIntegrator.add(withdrawAmount),
            )
            expect(await musdToken.balanceOf(cyMUSD.address), "cyMUSD mUSD after").to.eq(0)
        })
        it("fail to withdraw 1 more mUSD", async () => {
            const feederPool = FeederPoolV2__factory.connect(GUSD.feederPool, governor.signer)
            const withdrawAmount = simpleToExactAmount(1, mUSD.decimals)

            const tx = feederPool.cachePlatformIntegration(mUSD.address, withdrawAmount)

            await expect(tx).to.be.revertedWith("redeem failed")
        })
    })
    describe("swap", () => {
        const amount = 200
        // GUSD
        const testData = [
            { feederPoolAddress: GUSD.feederPool, fromAsset: GUSD, toAsset: mUSD, amount, whaleAddress: gusdWhaleAddress },
            { feederPoolAddress: GUSD.feederPool, fromAsset: GUSD, toAsset: sUSD, amount, whaleAddress: gusdWhaleAddress },
            { feederPoolAddress: GUSD.feederPool, fromAsset: GUSD, toAsset: DAI, amount, whaleAddress: gusdWhaleAddress },
            { feederPoolAddress: GUSD.feederPool, fromAsset: GUSD, toAsset: USDC, amount, whaleAddress: gusdWhaleAddress },
            { feederPoolAddress: GUSD.feederPool, fromAsset: GUSD, toAsset: USDT, amount, whaleAddress: gusdWhaleAddress },
            { feederPoolAddress: GUSD.feederPool, fromAsset: mUSD, toAsset: GUSD, amount, whaleAddress: musdWhaleAddress },
        ]
        // BUSD
        testData.concat([
            { feederPoolAddress: BUSD.feederPool, fromAsset: BUSD, toAsset: mUSD, amount, whaleAddress: busdWhaleAddress },
            { feederPoolAddress: BUSD.feederPool, fromAsset: BUSD, toAsset: sUSD, amount, whaleAddress: busdWhaleAddress },
            { feederPoolAddress: BUSD.feederPool, fromAsset: BUSD, toAsset: DAI, amount, whaleAddress: busdWhaleAddress },
            { feederPoolAddress: BUSD.feederPool, fromAsset: BUSD, toAsset: USDC, amount, whaleAddress: busdWhaleAddress },
            { feederPoolAddress: BUSD.feederPool, fromAsset: BUSD, toAsset: USDT, amount, whaleAddress: busdWhaleAddress },
            { feederPoolAddress: BUSD.feederPool, fromAsset: mUSD, toAsset: BUSD, amount, whaleAddress: musdWhaleAddress },
        ])
        // alUSD
        testData.concat([
            { feederPoolAddress: alUSD.feederPool, fromAsset: alUSD, toAsset: mUSD, amount, whaleAddress: alusdWhaleAddress },
            { feederPoolAddress: alUSD.feederPool, fromAsset: alUSD, toAsset: sUSD, amount, whaleAddress: alusdWhaleAddress },
            { feederPoolAddress: alUSD.feederPool, fromAsset: alUSD, toAsset: DAI, amount, whaleAddress: alusdWhaleAddress },
            { feederPoolAddress: alUSD.feederPool, fromAsset: alUSD, toAsset: USDC, amount, whaleAddress: alusdWhaleAddress },
            { feederPoolAddress: alUSD.feederPool, fromAsset: alUSD, toAsset: USDT, amount, whaleAddress: alusdWhaleAddress },
            { feederPoolAddress: alUSD.feederPool, fromAsset: mUSD, toAsset: alUSD, amount, whaleAddress: musdWhaleAddress },
        ])
        // RAI
        testData.concat([
            { feederPoolAddress: RAI.feederPool, fromAsset: RAI, toAsset: mUSD, amount, whaleAddress: raiWhaleAddress },
            { feederPoolAddress: RAI.feederPool, fromAsset: RAI, toAsset: sUSD, amount, whaleAddress: raiWhaleAddress },
            { feederPoolAddress: RAI.feederPool, fromAsset: RAI, toAsset: DAI, amount, whaleAddress: raiWhaleAddress },
            { feederPoolAddress: RAI.feederPool, fromAsset: RAI, toAsset: USDC, amount, whaleAddress: raiWhaleAddress },
            { feederPoolAddress: RAI.feederPool, fromAsset: RAI, toAsset: USDT, amount, whaleAddress: raiWhaleAddress },
            { feederPoolAddress: RAI.feederPool, fromAsset: mUSD, toAsset: RAI, amount, whaleAddress: musdWhaleAddress },
        ])
        // FAI
        testData.concat([
            { feederPoolAddress: FEI.feederPool, fromAsset: FEI, toAsset: mUSD, amount, whaleAddress: feiWhaleAddress },
            { feederPoolAddress: FEI.feederPool, fromAsset: FEI, toAsset: sUSD, amount, whaleAddress: feiWhaleAddress },
            { feederPoolAddress: FEI.feederPool, fromAsset: FEI, toAsset: DAI, amount, whaleAddress: feiWhaleAddress },
            { feederPoolAddress: FEI.feederPool, fromAsset: FEI, toAsset: USDC, amount, whaleAddress: feiWhaleAddress },
            { feederPoolAddress: FEI.feederPool, fromAsset: FEI, toAsset: USDT, amount, whaleAddress: feiWhaleAddress },
            { feederPoolAddress: FEI.feederPool, fromAsset: mUSD, toAsset: FEI, amount, whaleAddress: musdWhaleAddress },
        ])
        testData.forEach((test) => {
            it(`${test.amount} ${test.fromAsset.symbol} for ${test.toAsset.symbol}`, async () => {
                await assertSwap(test)
            })
        })
    })
    const mintTestData = (amount: number, asset: Token, whaleAddress: string) => [
        { asset, amount, feederPoolAddress: asset.feederPool, whaleAddress },
        { asset: mUSD, amount, feederPoolAddress: asset.feederPool, whaleAddress: musdWhaleAddress },
    ]
    describe("mint", () => {
        const testData = [
            ...mintTestData(1000, GUSD, gusdWhaleAddress),
            ...mintTestData(1000, BUSD, busdWhaleAddress),
            ...mintTestData(1000, alUSD, alusdWhaleAddress),
            ...mintTestData(1000, RAI, raiWhaleAddress),
            ...mintTestData(1000, FEI, feiWhaleAddress),
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol} to ${test.feederPoolAddress}`, async () => {
                await assertMint(test)
            })
        })
    })
    const redeemTestData = (amount: number, asset: Token, whaleAddress: string) => [
        { asset, amount, feederPoolAddress: asset.feederPool, whaleAddress },
        { asset: mUSD, amount, feederPoolAddress: asset.feederPool, whaleAddress },
    ]
    describe("redeem", () => {
        const testData = [
            ...redeemTestData(130, GUSD, gusdFpWhaleAddress),
            ...redeemTestData(500, BUSD, busdFpWhaleAddress),
            ...redeemTestData(10, alUSD, alusdFpWhaleAddress),
            ...redeemTestData(80, RAI, raiFpWhaleAddress),
            ...redeemTestData(50, FEI, feiFpWhaleAddress),
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol}`, async () => {
                await assertRedeemExact(test)
            })
        })
    })
    describe("operations", () => {
        it("collect Feeder Pool interest except GUSD", async () => {
            await increaseTime(ONE_WEEK)
            const tx = await feederPoolValidator.collectAndValidateInterest([
                // GUSD.feederPool,
                BUSD.feederPool,
                alUSD.feederPool,
                RAI.feederPool,
                FEI.feederPool,
            ])
            const receipt = await tx.wait()
            await expect(receipt.events[1]?.args.interest, "collected interest").to.equal(0)
        })
        it("collect GUSD Feeder Pool interest", async () => {
            await increaseTime(ONE_WEEK)
            const tx = await feederPoolValidator.collectAndValidateInterest([GUSD.feederPool])
            const receipt = await tx.wait()
            await expect(receipt.events[1]?.args.interest, "collected interest").to.gt(0)
        })
    })
})
