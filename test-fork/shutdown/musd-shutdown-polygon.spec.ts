import {
    Account,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    IERC20Metadata__factory,
    IERC20__factory,
    MassetManagerV2__factory,
    MassetPolygon,
    MassetPolygon__factory,
    Nexus,
    Nexus__factory,
    PAaveIntegration__factory,
    SavingsManager,
    SavingsManager__factory,
} from "types"
import { network } from "hardhat"
import { impersonateAccount } from "@utils/fork"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { Chain, PDAI, deployContract, PmUSD, PUSDC, PUSDT, Token } from "tasks/utils"
import { expect } from "chai"
import { increaseTime } from "@utils/time"
import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { formatUnits } from "ethers/lib/utils"
import { simpleToExactAmount } from "@utils/math"

const musdWhaleAddress = "0xb30a907084ac8a0d25dddab4e364827406fd09f0" // FRAX Feeder Pool
const usdcWhaleAddress = "0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245" // Binance Hot Wallet 2
const daiWhaleAddress = "0xe0810fd9a243f7d930c1afedca76fb3d4de972f5"
const usdtWhaleAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC" // BInance Hot Wallet

context("Polygon mUSD shutdown", async () => {
    let ops: Account
    let governor: Account
    let musdWhale: Account
    let nexus: Nexus
    let delayedProxyAdmin: DelayedProxyAdmin
    let musd: MassetPolygon
    let savingManager: SavingsManager
    let totalSupplyBefore
    let bAssetsBefore

    const assertBalances = async (bAssetIndex: number, token: Token, bAssetsAfter) => {
        expect(bAssetsAfter.bData[bAssetIndex].vaultBalance, `${bAssetIndex} vault balance`).to.eq(
            bAssetsBefore.bData[bAssetIndex].vaultBalance,
        )
        expect(bAssetsAfter.bData[bAssetIndex].ratio, `${token.symbol} ratio`).to.eq(bAssetsBefore.bData[bAssetIndex].ratio)
        expect(bAssetsAfter.personal[bAssetIndex].addr, `${token.symbol} addr`).to.eq(token.address)
        expect(bAssetsAfter.personal[bAssetIndex].integrator, `${token.symbol} integrator`).to.eq(ZERO_ADDRESS)
        expect(bAssetsAfter.personal[bAssetIndex].hasTxFee, `${token.symbol} hasTxFee`).to.eq(false)
        expect(bAssetsAfter.personal[bAssetIndex].status, `${token.symbol} status`).to.eq(bAssetsBefore.personal[bAssetIndex].status)

        // No more a tokens in the integrator contract
        const liquidityAsset = IERC20__factory.connect(token.liquidityProvider, ops.signer)
        expect(await liquidityAsset.balanceOf(token.integrator), `${token.symbol} integrator liquidity`).to.eq(0)

        // bAssets are now in the mAsset
        const bAsset = IERC20Metadata__factory.connect(token.address, ops.signer)
        const balance = await bAsset.balanceOf(PmUSD.address)
        expect(balance, `${bAssetIndex} bAsset cache`).to.gte(bAssetsBefore.bData[bAssetIndex].vaultBalance)
        // Are there extra bAssets in the mAsset compared to the vaultBalance?
        const balDiff = balance.sub(bAssetsBefore.bData[bAssetIndex].vaultBalance)
        const balDiffPercent = balDiff.mul(10000000000).div(bAssetsBefore.bData[bAssetIndex].vaultBalance)
        console.log(`${token.symbol} balance diff: ${formatUnits(balDiff, token.decimals)} (${formatUnits(balDiffPercent, 8)}%)`)
    }
    const assertMint = async (test: { asset: Token; amount: number; whaleAddress: string }) => {
        const { asset, amount, whaleAddress } = test
        const whale = await impersonateAccount(whaleAddress, false)

        const { bData: dataBefore } = await musd.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const assetContract = IERC20__factory.connect(asset.address, whale.signer)
        await assetContract.approve(musd.address, amountScaled)

        await musd.connect(whale.signer).mint(asset.address, amountScaled, 0, whale.address)

        const { bData: dataAfter } = await musd.getBasset(asset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(amountScaled))
    }
    const assertRedeemExact = async (test: { asset: Token; amount: number }) => {
        const { asset, amount } = test

        const { bData: dataBefore } = await musd.getBasset(asset.address)

        const amountScaled = simpleToExactAmount(amount, asset.decimals)
        const maxMusd = simpleToExactAmount(amount, PmUSD.decimals).mul(11).div(10)

        await musd.connect(musdWhale.signer).redeemExactBassets([asset.address], [amountScaled], maxMusd, musdWhale.address)

        const { bData: dataAfter } = await musd.getBasset(asset.address)
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
        ops = await impersonateAccount(resolveAddress("OperationsSigner", Chain.polygon))
        governor = await impersonateAccount(resolveAddress("Governor", Chain.polygon))
        musdWhale = await impersonateAccount(musdWhaleAddress)

        nexus = Nexus__factory.connect(resolveAddress("Nexus", Chain.polygon), governor.signer)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin", Chain.polygon), governor.signer)
        musd = MassetPolygon__factory.connect(PmUSD.address, musdWhale.signer)

        savingManager = SavingsManager__factory.connect(resolveAddress("SavingsManager", Chain.polygon), ops.signer)
    }

    before("reset block number", async () => {
        await runSetup(38960000)

        // Get before balances
        totalSupplyBefore = await musd.totalSupply()
        bAssetsBefore = await musd.getBassets()
    })

    it("deploy and upgrade mUSD implementation", async () => {
        // Deploy new mUSD Manager library
        const managerLib = await deployContract(new MassetManagerV2__factory(ops.signer), "MassetManagerV2")
        const libraryAddress = {
            "contracts/masset/legacy/musd-polygon.sol:MassetLogic": "0xb9cca2b53e8d7bc4cbddccb66d20b411b87d213f",
            "contracts/masset/legacy/musd-polygon.sol:MassetManagerV2": managerLib.address,
        }

        // Deploy new mUSD implementation
        const musdImpl = await deployContract(new MassetPolygon__factory(libraryAddress, ops.signer), "MassetPolygon", [nexus.address, 0])
        // Propose upgrade of mUSD
        await delayedProxyAdmin.proposeUpgrade(PmUSD.address, musdImpl.address, "0x")

        // Accept upgrade after 1 week
        await increaseTime(ONE_WEEK)
        await delayedProxyAdmin.acceptUpgradeRequest(PmUSD.address)

        // Test balances have not changed
        expect(await musd.totalSupply(), "total supply").to.eq(totalSupplyBefore)
    })
    it("migrate bAssets", async () => {
        await savingManager.collectAndStreamInterest(PmUSD.address)

        totalSupplyBefore = await musd.totalSupply()
        bAssetsBefore = await musd.getBassets()

        const cUSDC = IERC20__factory.connect(PUSDC.liquidityProvider, ops.signer)
        console.log(`${formatUnits(await cUSDC.balanceOf(PUSDC.integrator), 8)} cUSDC in integrator before`)
        const integrator = PAaveIntegration__factory.connect(PUSDC.integrator, ops.signer)
        console.log(`Aave integrator balance ${formatUnits(await integrator.checkBalance(PUSDC.address), PUSDC.decimals)} PUSDC before`)

        // migrate all 3 base assets from Aave
        await musd.connect(governor.signer).migrateBassets([PUSDC.address, PDAI.address, PUSDT.address], ZERO_ADDRESS)

        console.log(`${formatUnits(await cUSDC.balanceOf(PUSDC.integrator), 8)} cUSDC in integrator after`)
        console.log(`Comp integrator balance ${formatUnits(await integrator.checkBalance(PUSDC.address), PUSDC.decimals)} PUSDC after`)

        expect(await musd.totalSupply(), "total supply").to.eq(totalSupplyBefore)

        const bAssetsAfter = await musd.getBassets()
        await assertBalances(0, PUSDC, bAssetsAfter)
        await assertBalances(1, PDAI, bAssetsAfter)
        await assertBalances(2, PUSDT, bAssetsAfter)
    })
    it("set fees to zero", async () => {
        await musd.connect(governor.signer).setFees(0, 0)
        const data = await musd.data()
        expect(data.swapFee, "swap fee").to.eq(0)
        expect(data.redemptionFee, "redemption fee").to.eq(0)
    })
    it("set weight limits", async () => {
        const min = simpleToExactAmount(5, 16) // 5%
        const max = simpleToExactAmount(95, 17) // 95%
        await musd.connect(governor.signer).setWeightLimits(min, max)
        const data = await musd.data()
        expect(await data.weightLimits.min, "min weight").to.eq(min)
        expect(await data.weightLimits.max, "max weight").to.eq(max)
    })

    // can still mint, swap and redeem
    const assertSwap = async (test: { fromAsset: Token; toAsset: Token; amount: number; whaleAddress: string }) => {
        const { fromAsset, toAsset, amount, whaleAddress } = test
        const whale = await impersonateAccount(whaleAddress, false)

        const { bData: dataBefore } = await musd.getBasset(fromAsset.address)

        const swapAmount = simpleToExactAmount(amount, fromAsset.decimals)
        const swapAsset = IERC20__factory.connect(fromAsset.address, whale.signer)
        await swapAsset.approve(musd.address, swapAmount)

        const tx = await musd.connect(whale.signer).swap(fromAsset.address, toAsset.address, swapAmount, 0, whale.address)
        const receipt = await tx.wait()
        const event = receipt.events?.find((e) => e.event === "Swapped")
        expect(event.args?.scaledFee).to.eq(0)

        const { bData: dataAfter } = await musd.getBasset(fromAsset.address)
        expect(dataAfter.vaultBalance, "vault balances").to.eq(dataBefore.vaultBalance.add(swapAmount))
    }
    describe("swap", () => {
        const amount = 100000
        const testData = [
            { fromAsset: PUSDC, toAsset: PUSDT, amount, whaleAddress: usdcWhaleAddress },
            { fromAsset: PUSDC, toAsset: PDAI, amount, whaleAddress: usdcWhaleAddress },
            { fromAsset: PUSDT, toAsset: PUSDC, amount, whaleAddress: usdtWhaleAddress },
            { fromAsset: PUSDT, toAsset: PDAI, amount, whaleAddress: usdtWhaleAddress },
            { fromAsset: PDAI, toAsset: PUSDC, amount, whaleAddress: daiWhaleAddress },
            { fromAsset: PDAI, toAsset: PUSDT, amount, whaleAddress: daiWhaleAddress },
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
            { asset: PDAI, amount, whaleAddress: daiWhaleAddress },
            { asset: PUSDC, amount, whaleAddress: usdcWhaleAddress },
            { asset: PUSDT, amount, whaleAddress: usdtWhaleAddress },
        ]
        testData.forEach((test) => {
            it(`${test.amount} ${test.asset.symbol}`, async () => {
                await assertMint(test)
            })
        })
    })
    describe("redeem", () => {
        const amount = 100000
        const testData = [
            { asset: PDAI, amount },
            { asset: PUSDC, amount },
            { asset: PUSDT, amount },
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
            const tx = savingManager.collectAndStreamInterest(PmUSD.address)
            await expect(tx).to.revertedWith("Must collect something")
        })
    })
})
