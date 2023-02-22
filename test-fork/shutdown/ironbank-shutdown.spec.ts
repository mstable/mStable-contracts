import { impersonateAccount } from "@utils/fork"
import { Account, CompoundIntegration, CompoundIntegration__factory, ICERC20, ICERC20__factory, IERC20, IERC20__factory } from "types"
import { network } from "hardhat"
import { cyMUSD, GUSD, mUSD, usdFormatter } from "tasks/utils"
import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { resolveAddress } from "tasks/utils/networkAddressFactory"

const gusdIronBankIntegrationAddress = "0xaF007D4ec9a13116035a2131EA1C9bc0B751E3cf"

context("GUSD mUSD in Iron Bank", async () => {
    let integration: Account
    let gusdfFp: Account
    let treasury: Account
    let cymusdContract: ICERC20
    let musdContract: IERC20
    let integrationContract: CompoundIntegration
    let musdBefore: BN
    let cymusdBefore: BN
    let musdOwed: BN
    let musdShortfall: BN

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
        integration = await impersonateAccount(gusdIronBankIntegrationAddress)
        gusdfFp = await impersonateAccount(GUSD.feederPool)
        treasury = await impersonateAccount(resolveAddress("mStableDAO"))

        integrationContract = CompoundIntegration__factory.connect(gusdIronBankIntegrationAddress, gusdfFp.signer)
        musdContract = IERC20__factory.connect(mUSD.address, integration.signer)
        cymusdContract = ICERC20__factory.connect(cyMUSD.address, integration.signer)
    }

    before("reset block number", async () => {
        await runSetup(16674000)

        musdBefore = await musdContract.balanceOf(integration.address)
        console.log(`mUSD in integration before ${usdFormatter(musdBefore, mUSD.decimals)}`)

        cymusdBefore = await cymusdContract.balanceOf(integration.address)
        console.log(`cymUSD in integration before ${usdFormatter(cymusdBefore, cyMUSD.decimals)}`)

        const exchangeRate = await cymusdContract.exchangeRateStored()
        console.log(`cymUSD exchange rate ${exchangeRate.toString()}`)
        musdOwed = exchangeRate.mul(cymusdBefore).div(BN.from(10).pow(18))
        console.log(`${usdFormatter(musdOwed, mUSD.decimals)} mUSD owned to integration contract`)

        const musdBalance = await integrationContract.checkBalance(mUSD.address)
        console.log(`${usdFormatter(musdBalance, mUSD.decimals)} mUSD check balance on integration contract`)

        const musdLiquidity = await musdContract.balanceOf(cyMUSD.address)
        console.log(`${usdFormatter(musdLiquidity, mUSD.decimals)} mUSD liquidity in cymUSD`)

        musdShortfall = musdOwed.sub(musdLiquidity)
        console.log(`${usdFormatter(musdShortfall, mUSD.decimals)} mUSD shortfall in cymUSD`)
    })

    beforeEach("reset block number", async () => {
        await runSetup(16674000)
    })
    const successAmount = 1362
    it(`successful call static redeem ${successAmount} mUSD from cymUSD`, async () => {
        const musdAmount = simpleToExactAmount(successAmount, mUSD.decimals)
        const errorCode = await cymusdContract.callStatic.redeemUnderlying(musdAmount)
        expect(errorCode, "no error").to.eq(0)
    })
    const failAmount = 1363
    it(`failed call static redeem ${failAmount} mUSD from cymUSD`, async () => {
        const musdAmount = simpleToExactAmount(failAmount, mUSD.decimals)
        const errorCode = await cymusdContract.callStatic.redeemUnderlying(musdAmount)
        expect(errorCode, "rejection error").to.eq(14)
    })
    it.only(`successfully redeem ${successAmount} mUSD from cymUSD`, async () => {
        musdBefore = await musdContract.balanceOf(integration.address)

        const musdAmount = simpleToExactAmount(successAmount, mUSD.decimals)

        await cymusdContract.redeemUnderlying(musdAmount)

        const musdAfter = await musdContract.balanceOf(integration.address)
        console.log(`mUSD after: ${usdFormatter(musdAfter)}`)
        expect(musdAfter, "musd after").to.eq(musdBefore.add(musdAmount))
    })
    it(`failed redeem ${failAmount} mUSD from cymUSD`, async () => {
        const musdAmount = simpleToExactAmount(failAmount, mUSD.decimals)

        await cymusdContract.redeemUnderlying(musdAmount)

        expect(await musdContract.balanceOf(integration.address), "musd after").to.eq(musdBefore)
    })
    it.skip(`deposit shortfall and redeem all mUSD from cymUSD`, async () => {
        await musdContract.connect(treasury.signer).approve(cymusdContract.address, musdShortfall)
        await cymusdContract.connect(treasury.signer).mint(musdShortfall)

        await cymusdContract.redeemUnderlying(musdOwed)

        const musdAfter = await musdContract.balanceOf(integration.address)
        console.log(`mUSD after: ${usdFormatter(musdAfter)}`)
        expect(musdAfter, "musd after").to.eq(musdBefore.add(musdOwed))
    })
})
