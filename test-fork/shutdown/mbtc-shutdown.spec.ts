import {
    Account,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    IERC20Metadata__factory,
    IERC20__factory,
    MassetBtcV2,
    MassetBtcV2__factory,
    MassetManagerBtcV2__factory,
    Nexus,
    Nexus__factory,
    SavingsManager,
    SavingsManager__factory,
} from "types"
import { network } from "hardhat"
import { impersonateAccount } from "@utils/fork"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { sBTC, deployContract, mBTC, WBTC, renBTC, Token } from "tasks/utils"
import { expect } from "chai"
import { increaseTime } from "@utils/time"
import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { formatUnits } from "ethers/lib/utils"
import { simpleToExactAmount } from "@utils/math"

const mbtcWhaleAddress = "0x17d8cbb6bce8cee970a4027d1198f6700a7a6c24" // imBTC
const sbtcWhaleAddress = "0xa0f75491720835b36edC92D06DDc468D201e9b73"
const renbtcWhaleAddress = "0xaade032dc41dbe499debf54cfee86d13358e9afc"
const wbtcWhaleAddress = "0x218b95be3ed99141b0144dba6ce88807c4ad7c09"

context("mBTC shutdown", async () => {
    let ops: Account
    let governor: Account
    let mbtcWhale: Account
    let nexus: Nexus
    let delayedProxyAdmin: DelayedProxyAdmin
    let mbtc: MassetBtcV2
    let savingManager: SavingsManager
    let totalSupplyBefore
    let bAssetsBefore

    const assertBalances = async (bAssetIndex: number, token: Token, bAssetsAfter) => {
        expect(bAssetsAfter.data[bAssetIndex].vaultBalance, `${bAssetIndex} vault balance`).to.eq(
            bAssetsBefore.data[bAssetIndex].vaultBalance,
        )
        expect(bAssetsAfter.data[bAssetIndex].ratio, `${token.symbol} ratio`).to.eq(bAssetsBefore.data[bAssetIndex].ratio)
        expect(bAssetsAfter.personal[bAssetIndex].addr, `${token.symbol} addr`).to.eq(token.address)
        expect(bAssetsAfter.personal[bAssetIndex].integrator, `${token.symbol} integrator`).to.eq(ZERO_ADDRESS)
        expect(bAssetsAfter.personal[bAssetIndex].hasTxFee, `${token.symbol} hasTxFee`).to.eq(false)
        expect(bAssetsAfter.personal[bAssetIndex].status, `${token.symbol} status`).to.eq(bAssetsBefore.personal[bAssetIndex].status)

        // No more a tokens in the integrator contract
        if (token.liquidityProvider) {
            const liquidityAsset = IERC20__factory.connect(token.liquidityProvider, ops.signer)
            expect(await liquidityAsset.balanceOf(token.integrator), `${token.symbol} integrator liquidity`).to.eq(0)
        }

        // bAssets are now in the mAsset
        const bAsset = IERC20Metadata__factory.connect(token.address, ops.signer)
        const balance = await bAsset.balanceOf(mBTC.address)
        expect(balance, `${bAssetIndex} bAsset cache`).to.gte(bAssetsBefore.data[bAssetIndex].vaultBalance)
        // Are there extra bAssets in the mAsset compared to the vaultBalance?
        const balDiff = balance.sub(bAssetsBefore.data[bAssetIndex].vaultBalance)
        const balDiffPercent = balDiff.mul(10000000000).div(bAssetsBefore.data[bAssetIndex].vaultBalance)
        console.log(`${token.symbol} balance diff: ${formatUnits(balDiff, token.decimals)} (${formatUnits(balDiffPercent, 8)}%)`)
    }
    const assertMint = async (test: { asset: Token; amount: number; whaleAddress: string }) => {
        const { asset, amount, whaleAddress } = test
        const whale = await impersonateAccount(whaleAddress, false)

        const { data: dataBefore } = await mbtc.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const assetContract = IERC20__factory.connect(asset.address, whale.signer)
        await assetContract.approve(mbtc.address, amountScaled)

        await mbtc.connect(whale.signer).mint(asset.address, amountScaled, 0, whale.address)

        const { data: dataAfter } = await mbtc.getBasset(asset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(amountScaled))
    }
    const assertRedeemExact = async (test: { asset: Token; amount: number }) => {
        const { asset, amount } = test

        const { data: dataBefore } = await mbtc.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const maxMbtc = simpleToExactAmount(amount, mBTC.decimals).mul(11).div(10)

        await mbtc.connect(mbtcWhale.signer).redeemExactBassets([asset.address], [amountScaled], maxMbtc, mbtcWhale.address)

        const { data: dataAfter } = await mbtc.getBasset(asset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.sub(amountScaled))
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
        mbtcWhale = await impersonateAccount(mbtcWhaleAddress)

        nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor.signer)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor.signer)
        mbtc = MassetBtcV2__factory.connect(mBTC.address, mbtcWhale.signer)

        savingManager = SavingsManager__factory.connect(resolveAddress("SavingsManager"), ops.signer)
    }

    before("reset block number", async () => {
        await runSetup(16570000)

        // Get before balances
        totalSupplyBefore = await mbtc.totalSupply()
        bAssetsBefore = await mbtc.getBassets()
    })

    it("deploy and upgrade mBTC implementation", async () => {
        // Deploy new mBTC Manager library
        const managerLib = await deployContract(new MassetManagerBtcV2__factory(ops.signer), "MassetManagerBtcV2")
        const libraryAddress = {
            "contracts/masset/legacy/mbtc.sol:MassetManagerBtcV2": managerLib.address,
        }

        // Deploy new mBTC implementation
        const mbtcImpl = await deployContract(new MassetBtcV2__factory(libraryAddress, ops.signer), "MassetBtcV2", [nexus.address])
        // Propose upgrade of mBTC
        await delayedProxyAdmin.proposeUpgrade(mBTC.address, mbtcImpl.address, "0x")

        // Accept upgrade after 1 week
        await increaseTime(ONE_WEEK)
        await delayedProxyAdmin.acceptUpgradeRequest(mBTC.address)

        // Test balances have not changed
        expect(await mbtc.totalSupply(), "total supply").to.eq(totalSupplyBefore)
    })
    it("migrate bAssets", async () => {
        await savingManager.collectAndStreamInterest(mBTC.address)

        totalSupplyBefore = await mbtc.totalSupply()
        bAssetsBefore = await mbtc.getBassets()

        // migrate allWBTC from Aave
        await mbtc.connect(governor.signer).migrateBassets([WBTC.address], ZERO_ADDRESS)

        expect(await mbtc.totalSupply(), "total supply").to.eq(totalSupplyBefore)

        const bAssetsAfter = await mbtc.getBassets()
        await assertBalances(0, renBTC, bAssetsAfter)
        await assertBalances(1, sBTC, bAssetsAfter)
        await assertBalances(2, WBTC, bAssetsAfter)
    })
    it("set fees to zero", async () => {
        await mbtc.connect(governor.signer).setFees(0, 0)
        expect(await mbtc.swapFee(), "swap fee").to.eq(0)
        expect(await mbtc.redemptionFee(), "redemption fee").to.eq(0)
    })
    it("set weight limits", async () => {
        const min = simpleToExactAmount(5, 16) // 5%
        const max = simpleToExactAmount(95, 17) // 95%
        await mbtc.connect(governor.signer).setWeightLimits(min, max)
        const data = await mbtc.weightLimits()
        expect(await data.min, "min weight").to.eq(min)
        expect(await data.max, "max weight").to.eq(max)
    })

    // can still mint, swap and redeem
    const assertSwap = async (test: { fromAsset: Token; toAsset: Token; amount: number; whaleAddress: string }) => {
        const { fromAsset, toAsset, amount, whaleAddress } = test
        const whale = await impersonateAccount(whaleAddress, false)

        const { data: dataBefore } = await mbtc.getBasset(fromAsset.address)

        const swapAmount = simpleToExactAmount(amount, fromAsset.decimals)
        const swapAsset = IERC20__factory.connect(fromAsset.address, whale.signer)
        await swapAsset.approve(mbtc.address, swapAmount)

        const tx = await mbtc.connect(whale.signer).swap(fromAsset.address, toAsset.address, swapAmount, 0, whale.address)
        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "Swapped")
        expect(event.args?.scaledFee).to.eq(0)

        const { data: dataAfter } = await mbtc.getBasset(fromAsset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(swapAmount))
    }
    describe("swap", () => {
        const amount = 2
        const testData = [
            { fromAsset: renBTC, toAsset: WBTC, amount, whaleAddress: renbtcWhaleAddress },
            { fromAsset: renBTC, toAsset: sBTC, amount, whaleAddress: renbtcWhaleAddress },
            { fromAsset: sBTC, toAsset: WBTC, amount, whaleAddress: sbtcWhaleAddress },
            { fromAsset: sBTC, toAsset: renBTC, amount, whaleAddress: sbtcWhaleAddress },
            { fromAsset: WBTC, toAsset: renBTC, amount, whaleAddress: wbtcWhaleAddress },
            { fromAsset: WBTC, toAsset: sBTC, amount, whaleAddress: wbtcWhaleAddress },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.fromAsset.symbol} for ${test.toAsset.symbol}`, async () => {
                await assertSwap(test)
            })
        })
    })
    describe("mint", () => {
        const amount = 2
        const testData = [
            { asset: renBTC, amount, whaleAddress: renbtcWhaleAddress },
            { asset: sBTC, amount, whaleAddress: sbtcWhaleAddress },
            { asset: WBTC, amount, whaleAddress: wbtcWhaleAddress },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol}`, async () => {
                await assertMint(test)
            })
        })
    })
    describe("redeem", () => {
        const testData = [
            { asset: sBTC, amount: 2 },
            { asset: WBTC, amount: 2 },
            { asset: renBTC, amount: 0.1 },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol}`, async () => {
                await assertRedeemExact(test)
            })
        })
    })
    describe("operations", () => {
        it("collect and stream interest", async () => {
            await increaseTime(ONE_WEEK)
            const tx = savingManager.collectAndStreamInterest(mBTC.address)
            await expect(tx).to.revertedWith("Must collect something")
        })
    })
})
