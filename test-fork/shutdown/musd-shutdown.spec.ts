import {
    Account,
    CompoundIntegration__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ICERC20__factory,
    IERC20Metadata__factory,
    IERC20__factory,
    MassetManagerV4__factory,
    MusdV4,
    MusdV4__factory,
    Nexus,
    Nexus__factory,
    SavingsManager,
    SavingsManager__factory,
} from "types"
import { network } from "hardhat"
import { impersonateAccount } from "@utils/fork"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { DAI, deployContract, mUSD, sUSD, Token, USDC, USDT } from "tasks/utils"
import { expect } from "chai"
import { increaseTime } from "@utils/time"
import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { formatUnits } from "ethers/lib/utils"
import { BN, simpleToExactAmount } from "@utils/math"
import { assertBNClose } from "@utils/assertions"

const musdWhaleAddress = "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43"
const susdWhaleAddress = "0x27Cc4d6bc95b55a3a981BF1F1c7261CDa7bB0931"
const usdcWhaleAddress = "0x28c6c06298d514db089934071355e5743bf21d60"
const daiWhaleAddress = "0x075e72a5edf65f0a5f44699c7654c1a76941ddc8"
const usdtWhaleAddress = "0xf977814e90da44bfa03b6295a0616a897441acec"

context("mUSD shutdown", async () => {
    let ops: Account
    let governor: Account
    let musdWhale: Account
    let nexus: Nexus
    let delayedProxyAdmin: DelayedProxyAdmin
    let musd: MusdV4
    let savingManager: SavingsManager

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
        const liquidityAsset = IERC20__factory.connect(token.liquidityProvider, ops.signer)
        if (token.symbol !== "USDC") {
            expect(await liquidityAsset.balanceOf(token.integrator), `${token.symbol} integrator liquidity`).to.eq(0)
        } else {
            const liquidityAssetBal = await liquidityAsset.balanceOf(token.integrator)
            // Less than 0.5 cUSDC left
            assertBNClose(liquidityAssetBal, BN.from(0), 5e7)
        }

        // bAssets are now in the mAsset
        const bAsset = IERC20Metadata__factory.connect(token.address, ops.signer)
        const balance = await bAsset.balanceOf(mUSD.address)
        expect(balance, `${bAssetIndex} bAsset cache`).to.gte(bAssetsBefore.data[bAssetIndex].vaultBalance)
        // Are there extra bAssets in the mAsset compared to the vaultBalance?
        const balDiff = balance.sub(bAssetsBefore.data[bAssetIndex].vaultBalance)
        const balDiffPercent = balDiff.mul(10000000000).div(bAssetsBefore.data[bAssetIndex].vaultBalance)
        console.log(`${token.symbol} balance diff: ${formatUnits(balDiff, token.decimals)} (${formatUnits(balDiffPercent, 8)}%)`)
    }
    // can still mint, swap and redeem
    const assertSwap = async (test: { fromAsset: Token; toAsset: Token; amount: number; whaleAddress: string }) => {
        const { fromAsset, toAsset, amount, whaleAddress } = test
        const whale = await impersonateAccount(whaleAddress, false)

        const { data: dataBefore } = await musd.getBasset(fromAsset.address)

        const swapAmount = simpleToExactAmount(amount, fromAsset.decimals)
        const swapAsset = IERC20__factory.connect(fromAsset.address, whale.signer)
        await swapAsset.approve(musd.address, swapAmount)

        const tx = await musd.connect(whale.signer).swap(fromAsset.address, toAsset.address, swapAmount, 0, whale.address)
        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "Swapped")
        expect(event.args?.scaledFee).to.eq(0)

        const { data: dataAfter } = await musd.getBasset(fromAsset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(swapAmount))
    }
    const assertMint = async (test: { asset: Token; amount: number; whaleAddress: string }) => {
        const { asset, amount, whaleAddress } = test
        const whale = await impersonateAccount(whaleAddress, false)

        const { data: dataBefore } = await musd.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const assetContract = IERC20__factory.connect(asset.address, whale.signer)
        await assetContract.approve(musd.address, amountScaled)

        await musd.connect(whale.signer).mint(asset.address, amountScaled, 0, whale.address)

        const { data: dataAfter } = await musd.getBasset(asset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(amountScaled))
    }
    const assertRedeemExact = async (test: { asset: Token; amount: number }) => {
        const { asset, amount } = test

        const { data: dataBefore } = await musd.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const maxMusd = simpleToExactAmount(amount, mUSD.decimals).mul(11).div(10)

        await musd.connect(musdWhale.signer).redeemExactBassets([asset.address], [amountScaled], maxMusd, musdWhale.address)

        const { data: dataAfter } = await musd.getBasset(asset.address)
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
        musdWhale = await impersonateAccount(musdWhaleAddress)

        nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor.signer)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor.signer)
        musd = MusdV4__factory.connect(mUSD.address, musdWhale.signer)

        savingManager = SavingsManager__factory.connect(resolveAddress("SavingsManager"), ops.signer)
    }

    let totalSupplyBefore
    let bAssetsBefore
    before("reset block number", async () => {
        await runSetup(16537000)

        // Get before balances
        totalSupplyBefore = await musd.totalSupply()
        bAssetsBefore = await musd.getBassets()
    })

    it("deploy and upgrade mUSD implementation", async () => {
        // Deploy new mUSD Manager library
        const managerLib = await deployContract(new MassetManagerV4__factory(ops.signer), "MassetManagerV4")
        const libraryAddress = {
            "contracts/masset/legacy/musd.sol:MassetManagerV4": managerLib.address,
        }

        // Deploy new mUSD implementation
        const musdImpl = await deployContract(new MusdV4__factory(libraryAddress, ops.signer), "MusdV4", [nexus.address])
        // Propose upgrade of mUSD
        await delayedProxyAdmin.proposeUpgrade(mUSD.address, musdImpl.address, "0x")

        // Accept upgrade after 1 week
        await increaseTime(ONE_WEEK)
        await delayedProxyAdmin.acceptUpgradeRequest(mUSD.address)

        // Test balances have not changed
        expect(await musd.totalSupply(), "total supply").to.eq(totalSupplyBefore)
    })
    it("migrate bAssets", async () => {
        await savingManager.collectAndStreamInterest(mUSD.address)

        totalSupplyBefore = await musd.totalSupply()
        bAssetsBefore = await musd.getBassets()

        const cUSDC = IERC20__factory.connect(USDC.liquidityProvider, ops.signer)
        console.log(`${formatUnits(await cUSDC.balanceOf(USDC.integrator), 8)} cUSDC in integrator before`)
        const compInt = CompoundIntegration__factory.connect(USDC.integrator, ops.signer)
        console.log(`Comp integrator balance ${formatUnits(await compInt.checkBalance(USDC.address), USDC.decimals)} USDC before`)

        const cusdc = ICERC20__factory.connect(USDC.liquidityProvider, ops.signer)
        await cusdc.accrueInterest()

        // migrate all 4 base assets from Compound and Aave
        await musd.connect(governor.signer).migrateBassets([sUSD.address, USDC.address, DAI.address, USDT.address], ZERO_ADDRESS)

        console.log(`${formatUnits(await cUSDC.balanceOf(USDC.integrator), 8)} cUSDC in integrator after`)
        console.log(`Comp integrator balance ${formatUnits(await compInt.checkBalance(USDC.address), USDC.decimals)} USDC after`)

        expect(await musd.totalSupply(), "total supply").to.eq(totalSupplyBefore)

        const bAssetsAfter = await musd.getBassets()
        await assertBalances(0, sUSD, bAssetsAfter)
        await assertBalances(1, USDC, bAssetsAfter)
        await assertBalances(2, DAI, bAssetsAfter)
        await assertBalances(3, USDT, bAssetsAfter)
    })
    it("set fees to zero", async () => {
        await musd.connect(governor.signer).setFees(0, 0)
        expect(await musd.swapFee(), "swap fee").to.eq(0)
        expect(await musd.redemptionFee(), "redemption fee").to.eq(0)
    })
    describe("swap", () => {
        const amount = 100000
        const testData = [
            { fromAsset: sUSD, toAsset: USDT, amount, whaleAddress: susdWhaleAddress },
            { fromAsset: sUSD, toAsset: USDC, amount, whaleAddress: susdWhaleAddress },
            { fromAsset: sUSD, toAsset: DAI, amount, whaleAddress: susdWhaleAddress },
            { fromAsset: USDC, toAsset: sUSD, amount, whaleAddress: usdcWhaleAddress },
            { fromAsset: USDC, toAsset: USDT, amount, whaleAddress: usdcWhaleAddress },
            { fromAsset: USDC, toAsset: DAI, amount, whaleAddress: usdcWhaleAddress },
            { fromAsset: USDT, toAsset: sUSD, amount, whaleAddress: usdtWhaleAddress },
            { fromAsset: USDT, toAsset: USDC, amount, whaleAddress: usdtWhaleAddress },
            { fromAsset: USDT, toAsset: DAI, amount, whaleAddress: usdtWhaleAddress },
            { fromAsset: DAI, toAsset: sUSD, amount, whaleAddress: daiWhaleAddress },
            { fromAsset: DAI, toAsset: USDC, amount, whaleAddress: daiWhaleAddress },
            { fromAsset: DAI, toAsset: USDT, amount, whaleAddress: daiWhaleAddress },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.fromAsset.symbol} for ${test.toAsset.symbol}`, async () => {
                await assertSwap(test)
            })
        })
    })
    describe("mint", () => {
        const amount = 100000
        const testData = [
            { asset: sUSD, amount, whaleAddress: susdWhaleAddress },
            { asset: DAI, amount, whaleAddress: daiWhaleAddress },
            { asset: USDC, amount, whaleAddress: usdcWhaleAddress },
            { asset: USDT, amount, whaleAddress: usdtWhaleAddress },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol}`, async () => {
                await assertMint(test)
            })
        })
    })
    describe("redeem", () => {
        const amount = 50000
        const testData = [
            { asset: sUSD, amount },
            { asset: DAI, amount },
            { asset: USDC, amount },
            { asset: USDT, amount },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol}`, async () => {
                await assertRedeemExact(test)
            })
        })
    })
    describe("mUSD operations", () => {
        it("collect and stream interest", async () => {
            await increaseTime(ONE_WEEK)
            const tx = savingManager.collectAndStreamInterest(mUSD.address)
            await expect(tx).to.revertedWith("Must collect something")
        })
    })
})
