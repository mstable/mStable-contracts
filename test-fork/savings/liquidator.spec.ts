/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { impersonateAccount } from "@utils/fork"
import { ethers, network } from "hardhat"
import { Account } from "types"
import { deployContract } from "tasks/utils/deploy-utils"
import { AAVE, stkAAVE, mBTC, mUSD, USDC, WBTC, COMP, GUSD, BUSD, CREAM, cyMUSD, USDT } from "tasks/utils/tokens"
import {
    CompoundIntegration__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20,
    ERC20__factory,
    FeederPool,
    FeederPool__factory,
    IUniswapV3Quoter,
    IUniswapV3Quoter__factory,
    Liquidator,
    Liquidator__factory,
} from "types/generated"
import { AaveStakedTokenV2 } from "types/generated/AaveStakedTokenV2"
import { AaveStakedTokenV2__factory } from "types/generated/factories/AaveStakedTokenV2__factory"
import { expect } from "chai"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { increaseTime } from "@utils/time"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { resolveAddress } from "tasks/utils/networkAddressFactory"

// Addresses for signers
const opsAddress = resolveAddress("OperationsSigner")
const governorAddress = resolveAddress("Governor")
const delayedAdminAddress = resolveAddress("DelayedProxyAdmin")
const stkAaveWhaleAddress = "0xdb5AA12AD695Ef2a28C6CdB69f2BB04BEd20a48e"
const musdWhaleAddress = "0x9b0c19000a8631c1f555bb365bDE308384E4f2Ff"

const liquidatorAddress = resolveAddress("Liquidator")
const aaveMusdIntegrationAddress = USDT.integrator
const aaveMbtcIntegrationAddress = WBTC.integrator
const compoundIntegrationAddress = USDC.integrator
const nexusAddress = resolveAddress("Nexus")
const uniswapRouterV3Address = resolveAddress("UniswapRouterV3")
const uniswapQuoterV3Address = resolveAddress("UniswapQuoterV3")
const uniswapEthToken = resolveAddress("UniswapEthToken")

const gusdIronBankIntegrationAddress = "0xaF007D4ec9a13116035a2131EA1C9bc0B751E3cf"
const busdIronBankIntegrationAddress = "0x2A15794575e754244F9C0A15F504607c201f8AfD"

const uniswapCompUsdcPaths = encodeUniswapPath([COMP.address, uniswapEthToken, USDC.address], [3000, 3000])
const uniswapAaveUsdcPath = encodeUniswapPath([AAVE.address, uniswapEthToken, USDC.address], [3000, 3000])
const uniswapAaveWbtcPath = encodeUniswapPath([AAVE.address, uniswapEthToken, WBTC.address], [3000, 3000])
const uniswapAaveGusdPath = encodeUniswapPath([AAVE.address, uniswapEthToken, GUSD.address], [3000, 3000])

context("Liquidator forked network tests", () => {
    let ops: Account
    let governor: Account
    let stkAaveWhale: Account
    let musdWhale: Account
    let delayedProxyAdmin: DelayedProxyAdmin
    let aaveToken: ERC20
    let aaveStakedToken: AaveStakedTokenV2
    let compToken: ERC20
    let creamToken: ERC20
    let musdToken: ERC20
    let uniswapQuoter: IUniswapV3Quoter

    async function runSetup(blockNumber: number) {
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
        ops = await impersonateAccount(opsAddress)
        stkAaveWhale = await impersonateAccount(stkAaveWhaleAddress)
        governor = await impersonateAccount(governorAddress)
        musdWhale = await impersonateAccount(musdWhaleAddress)

        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, governor.signer)
        uniswapQuoter = IUniswapV3Quoter__factory.connect(uniswapQuoterV3Address, ops.signer)
        aaveToken = ERC20__factory.connect(AAVE.address, ops.signer)
        aaveStakedToken = AaveStakedTokenV2__factory.connect(stkAAVE.address, stkAaveWhale.signer)
        compToken = ERC20__factory.connect(COMP.address, ops.signer)
        creamToken = ERC20__factory.connect(CREAM.address, ops.signer)
        musdToken = ERC20__factory.connect(mUSD.address, ops.signer)
    }

    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
    })
    context("Aave liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12510100)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
            expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address)
            expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address)
            expect(await liquidator.aaveToken(), "Aave address").to.eq(AAVE.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAAVE.address)
            expect(await liquidator.compToken(), "COMP address").to.eq(COMP.address)
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
        })
        it("Added liquidation for mBTC Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMbtcIntegrationAddress,
                    AAVE.address,
                    WBTC.address,
                    uniswapAaveWbtcPath.encoded,
                    uniswapAaveWbtcPath.encodedReversed,
                    0,
                    simpleToExactAmount(2, WBTC.decimals - 3),
                    mBTC.address,
                    true,
                )
        })
        it.skip("Added liquidation for GUSD Feeder Pool Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    GUSD.integrator,
                    AAVE.address,
                    GUSD.address,
                    uniswapAaveGusdPath.encoded,
                    uniswapAaveGusdPath.encodedReversed,
                    0,
                    simpleToExactAmount(50, GUSD.decimals),
                    ZERO_ADDRESS,
                    true,
                )
        })
        it("Claim stkAave from each integration contract", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore)
        })
        it("Fail to claim stkAave again before liquidation", async () => {
            const tx = liquidator.claimStakedAave()
            await expect(tx).revertedWith("Last claim cooldown not ended")
        })
        it("trigger liquidation of Aave after 11 days", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0)
        })
        it("Fail to trigger liquidation of Aave again", async () => {
            const tx = liquidator.triggerLiquidationAave()
            await expect(tx).revertedWith("Must claim before liquidation")
        })
    })
    context("Aave liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12510100)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
        })
        it("Claim stkAave from each integration contract", async () => {
            const totalAaveClaimedBefore = await liquidator.totalAaveBalance()
            expect(totalAaveClaimedBefore, "totalAaveBalance before").to.eq(0)
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)

            await liquidator.claimStakedAave()

            const liquidatorStkAaveBalance = await aaveStakedToken.balanceOf(liquidatorAddress)
            expect(liquidatorStkAaveBalance, "Liquidator's stkAave increased").gt(aaveBalanceBefore)
            expect(await liquidator.totalAaveBalance(), "totalAaveBalance after").to.eq(liquidatorStkAaveBalance)
        })
        it("Fail to claim stkAave during cool down period", async () => {
            const tx = liquidator.claimStakedAave()
            await expect(tx).revertedWith("Last claim cooldown not ended")
        })
        it("Fail to claim stkAave during unstake period", async () => {
            // Move time past the 10 day cooldown period
            await increaseTime(ONE_DAY.mul(10).add(60))
            const tx = liquidator.claimStakedAave()
            await expect(tx).revertedWith("Must liquidate last claim")
        })
        it("Fail to trigger liquidation of Aave after cooldown and unstake periods", async () => {
            // Move time past the 2 day unstake period
            await increaseTime(ONE_DAY.mul(3))
            const tx = liquidator.triggerLiquidationAave()
            await expect(tx).revertedWith("UNSTAKE_WINDOW_FINISHED")
        })
        it("Claim stkAave again after unstake period", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave has increased").gt(aaveBalanceBefore)
        })
        it("trigger liquidation of Aave after 11 days", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0)
        })
        it("Claim stkAave after liquidation", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore)
        })
    })
    context("Compound liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12545500)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Read functions before upgrade", async () => {
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
        })
        it("Liquidate COMP before upgrade", async () => {
            await increaseTime(ONE_WEEK)
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(compoundIntegrationAddress)
            expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)

            // Public immutable values
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
            expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address)
            expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address)
            expect(await liquidator.aaveToken(), "Aave address").to.eq(AAVE.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAAVE.address)
            expect(await liquidator.compToken(), "COMP address").to.eq(COMP.address)
        })
        it("Added liquidation for mUSD Compound integration", async () => {
            const data = liquidator.interface.encodeFunctionData("createLiquidation", [
                compoundIntegrationAddress,
                COMP.address,
                USDC.address,
                uniswapCompUsdcPaths.encoded,
                uniswapCompUsdcPaths.encodedReversed,
                simpleToExactAmount(20000, USDC.decimals),
                simpleToExactAmount(100, USDC.decimals),
                mUSD.address,
                false,
            ])
            console.log(`createLiquidation data for COMP: ${data}`)
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    compoundIntegrationAddress,
                    COMP.address,
                    USDC.address,
                    uniswapCompUsdcPaths.encoded,
                    uniswapCompUsdcPaths.encodedReversed,
                    simpleToExactAmount(20000, USDC.decimals),
                    simpleToExactAmount(100, USDC.decimals),
                    mUSD.address,
                    false,
                )
        })
        it("Uniswap quoteExactOutputSingle for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutputSingle(
                COMP.address,
                uniswapEthToken,
                3000,
                simpleToExactAmount(8),
                0,
            )
            expect(expectedSwapInput).to.gt(simpleToExactAmount(40))
            expect(expectedSwapInput).to.lt(simpleToExactAmount(60))
        })
        it("Uniswap quoteExactOutputSingle for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutputSingle(
                uniswapEthToken,
                USDC.address,
                3000,
                simpleToExactAmount(20000, USDC.decimals),
                0,
            )
            expect(expectedSwapInput).to.gt(simpleToExactAmount(7))
            expect(expectedSwapInput).to.lt(simpleToExactAmount(8))
        })
        it("Uniswap quoteExactInput for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactInput(
                encodeUniswapPath([COMP.address, uniswapEthToken], [3000]).encoded,
                simpleToExactAmount(50),
            )
            console.log(`50 COMP input to swap for ${formatUnits(expectedSwapInput)} ETH`)
            expect(expectedSwapInput).to.gt(simpleToExactAmount(7))
            expect(expectedSwapInput).to.lt(simpleToExactAmount(9))
        })
        it("Uniswap quoteExactInput for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactInput(
                encodeUniswapPath([uniswapEthToken, USDC.address], [3000]).encoded,
                simpleToExactAmount(8),
            )
            console.log(`8 WETH input to swap for ${formatUnits(expectedSwapInput)} USDC`)
            expect(expectedSwapInput, "output > 19k USDC").to.gt(simpleToExactAmount(19000, USDC.decimals))
            expect(expectedSwapInput, "output < 22k USDC").to.lt(simpleToExactAmount(22000, USDC.decimals))
        })
        it("Uniswap quoteExactOutput for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(
                encodeUniswapPath([uniswapEthToken, COMP.address], [3000]).encoded,
                simpleToExactAmount(8),
            )
            console.log(`${(formatUnits(expectedSwapInput), COMP.decimals)} COMP input to swap for 8 ETH`)
            expect(expectedSwapInput, "input > 40 COMP").to.gt(simpleToExactAmount(40))
            expect(expectedSwapInput, "input < 60 COMP").to.lt(simpleToExactAmount(60))
        })
        it("Uniswap quoteExactOutput for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(
                encodeUniswapPath([USDC.address, uniswapEthToken], [3000]).encoded,
                simpleToExactAmount(20000, USDC.decimals),
            )
            expect(expectedSwapInput, "input > 7 WETH").to.gt(simpleToExactAmount(7))
            expect(expectedSwapInput, "input < 8 WETH").to.lt(simpleToExactAmount(8))
        })
        it("Uniswap quoteExactOutput for COMP to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(
                encodeUniswapPath([USDC.address, uniswapEthToken, COMP.address], [3000, 3000]).encoded,
                simpleToExactAmount(20000, USDC.decimals),
            )
            expect(expectedSwapInput, "input > 40 COMP").to.gt(simpleToExactAmount(40))
            expect(expectedSwapInput, "input < 60 COMP").to.lt(simpleToExactAmount(60))
        })
        it("Liquidate COMP after upgrade", async () => {
            await increaseTime(ONE_WEEK)
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress)

            await liquidator.triggerLiquidation(compoundIntegrationAddress)

            expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore)
        })
    })
    context("Iron Bank CREAM liquidation", () => {
        let liquidator: Liquidator
        let gusdFp: FeederPool
        let busdFp: FeederPool
        before("reset block number", async () => {
            await runSetup(12540000)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
            gusdFp = FeederPool__factory.connect(GUSD.feederPool, governor.signer)
            busdFp = FeederPool__factory.connect(BUSD.feederPool, governor.signer)
        })
        it("migrate mUSD to Iron Bank for the GUSD Feeder Pool", async () => {
            // Before migrate checks
            const musdInGusdBefore = await musdToken.balanceOf(GUSD.feederPool)
            expect(musdInGusdBefore, "Some mUSD in GUSD FP before").to.gt(0)
            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "no mUSD in Iron Bank integration before").to.eq(0)
            const musdInIronBankBefore = await musdToken.balanceOf(cyMUSD.address)
            console.log(
                `mUSD in Iron Bank ${formatUnits(musdInIronBankBefore)} and GUSD Feeder Pool ${formatUnits(musdInGusdBefore)} before`,
            )

            await gusdFp.migrateBassets([mUSD.address], gusdIronBankIntegrationAddress)

            // After migrate checks
            const musdInIronBankIntegrationAfter = await musdToken.balanceOf(gusdIronBankIntegrationAddress)
            console.log(`mUSD in Iron Bank ${formatUnits(musdInIronBankIntegrationAfter)} after`)
            expect(await musdToken.balanceOf(GUSD.feederPool), "no mUSD in GUSD FP after").to.eq(0)
            expect(await musdToken.balanceOf(cyMUSD.address), "no more mUSD in Iron Bank after").to.eq(musdInIronBankBefore)
            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "mUSD moved to Iron Bank integration after").to.eq(
                musdInGusdBefore,
            )
        })
        it("Swap mUSD for GUSD", async () => {
            const musdInIronBankBefore = await musdToken.balanceOf(cyMUSD.address)
            const musdInIntegrationBefore = await musdToken.balanceOf(gusdIronBankIntegrationAddress)

            const swapInput = simpleToExactAmount(1000)
            await musdToken.connect(musdWhale.signer).approve(gusdFp.address, swapInput)
            await gusdFp.connect(musdWhale.signer).swap(mUSD.address, GUSD.address, swapInput, 0, ops.address)

            expect(await musdToken.balanceOf(cyMUSD.address), "more mUSD in Iron Bank after").to.gt(musdInIronBankBefore)
            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "less mUSD in Integration after").to.lt(
                musdInIntegrationBefore,
            )
        })
        it("migrate mUSD to Iron Bank for the BUSD Feeder Pool", async () => {
            const musdBalanceBefore = await musdToken.balanceOf(BUSD.feederPool)
            expect(musdBalanceBefore).to.gt(0)
            await busdFp.migrateBassets([mUSD.address], busdIronBankIntegrationAddress)
            expect(await musdToken.balanceOf(BUSD.feederPool)).to.eq(0)
        })
        it("Governor approves the liquidator to transfer CREAM from integration contracts", async () => {
            const gusdIronBankIntegration = CompoundIntegration__factory.connect(gusdIronBankIntegrationAddress, governor.signer)
            await gusdIronBankIntegration.approveRewardToken()

            const busdIronBankIntegration = CompoundIntegration__factory.connect(busdIronBankIntegrationAddress, governor.signer)
            await busdIronBankIntegration.approveRewardToken()
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)

            // Public immutable values
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
            expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address)
            expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address)
            expect(await liquidator.aaveToken(), "AAVE address").to.eq(AAVE.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAAVE.address)
            expect(await liquidator.compToken(), "COMP address").to.eq(COMP.address)
        })
        it("Added liquidation of CREAM from GUSD and BUSD Feeder Pool integrations to Iron Bank", async () => {
            let uniswapPathCreamGusd = encodeUniswapPath([CREAM.address, uniswapEthToken, GUSD.address], [3000, 3000])
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    gusdIronBankIntegrationAddress,
                    CREAM.address,
                    GUSD.address,
                    uniswapPathCreamGusd.encoded,
                    uniswapPathCreamGusd.encodedReversed,
                    0,
                    simpleToExactAmount(50, GUSD.decimals),
                    ZERO_ADDRESS,
                    false,
                )

            uniswapPathCreamGusd = encodeUniswapPath([CREAM.address, uniswapEthToken, BUSD.address], [3000, 3000])
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    busdIronBankIntegrationAddress,
                    CREAM.address,
                    BUSD.address,
                    uniswapPathCreamGusd.encoded,
                    uniswapPathCreamGusd.encodedReversed,
                    0,
                    simpleToExactAmount(50, BUSD.decimals),
                    ZERO_ADDRESS,
                    false,
                )
        })
        it.skip("Liquidate CREAM after upgrade for GUSD", async () => {
            await increaseTime(ONE_WEEK)
            const creamBalanceBefore = await creamToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(gusdIronBankIntegrationAddress)
            expect(await creamToken.balanceOf(liquidatorAddress), "Less CREAM").lt(creamBalanceBefore)
        })
        it.skip("Liquidate CREAM after upgrade for BUSD", async () => {
            const creamBalanceBefore = await creamToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(busdIronBankIntegrationAddress)
            expect(await creamToken.balanceOf(liquidatorAddress), "Less CREAM").lt(creamBalanceBefore)
        })
    })
    context("Negative tests", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12500000)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)

            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Fail to call upgrade again", async () => {
            const tx = liquidator.upgrade()
            await expect(tx).revertedWith("SafeERC20: approve from non-zero to non-zero allowance")
        })
        it("short Uniswap path", async () => {
            const path = encodeUniswapPath([AAVE.address], [])
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    path.encoded,
                    path.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Uniswap path too short")
        })
        it("reversed Uniswap path", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encodedReversed,
                    uniswapAaveUsdcPath.encoded,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Invalid uniswap path")
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
        })
        it("Fail to add duplicate liquidation", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Liquidation already exists")
        })
    })
    context("Aave liquidate using deployed contract", () => {
        before("reset block number", async () => {
            await runSetup(13211000)
        })
        it("Accept ALCX upgrade", async () => {
            const liquidator = DelayedProxyAdmin__factory.connect(delayedAdminAddress, governor.signer)
            await liquidator.acceptUpgradeRequest(liquidatorAddress)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                COMP.address,
                resolveAddress("ALCX"),
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, "0x")
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)
        })
        it("claim stkAAave", async () => {
            const liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
            await liquidator.claimStakedAave()
        })
        it("delete GUSD", async () => {
            const liquidator = Liquidator__factory.connect(liquidatorAddress, governor.signer)
            await liquidator.deleteLiquidation(GUSD.integrator)
        })
        it("liquidate aave", async () => {
            await increaseTime(ONE_DAY.mul(11))
            const liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
            await liquidator.triggerLiquidationAave()
            expect(await aaveToken.balanceOf(liquidatorAddress), "Aave after").to.gt(simpleToExactAmount(45))
            expect(await aaveToken.balanceOf(liquidatorAddress), "Aave after").to.lt(simpleToExactAmount(46))
        })
    })
})
