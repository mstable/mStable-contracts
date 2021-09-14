import { MAX_UINT256, ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Signer, constants } from "ethers"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import { deployFeederPool, deployVault, FeederData, VaultData } from "tasks/utils/feederUtils"
import { getChainAddress } from "tasks/utils/networkAddressFactory"
import { AAVE, ALCX, alUSD, Chain, COMP, DAI, MTA, mUSD, stkAAVE, USDC } from "tasks/utils/tokens"
import {
    AlchemixIntegration,
    BoostedVault,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    FeederPool,
    FeederPool__factory,
    IERC20,
    IERC20__factory,
    Liquidator,
    LiquidatorProxy__factory,
    Liquidator__factory,
} from "types/generated"
import { AlchemixIntegration__factory } from "types/generated/factories/AlchemixIntegration__factory"
import { IAlchemixStakingPools__factory } from "types/generated/factories/IAlchemixStakingPools__factory"
import { RewardsDistributorEth__factory } from "types/generated/factories/RewardsDistributorEth__factory"
import { IAlchemixStakingPools } from "types/generated/IAlchemixStakingPools"
import { RewardsDistributorEth } from "types/generated/RewardsDistributorEth"

const chain = Chain.mainnet
const nexusAddress = getChainAddress("Nexus", chain)
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const liquidatorAddress = getChainAddress("Liquidator", chain)
const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
const alchemixStakingPoolsAddress = getChainAddress("AlchemixStakingPool", chain)
const uniswapRouterAddress = getChainAddress("UniswapRouterV3", chain)
const uniswapQuoterAddress = getChainAddress("UniswapQuoterV3", chain)
const uniswapEthToken = getChainAddress("UniswapEthToken", Chain.mainnet)

const governorAddress = getChainAddress("Governor", chain)
const fundManagerAddress = getChainAddress("FundManager", chain)
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x69E0E2b3d523D3b247d798a49C3fa022a46DD6bd"
const alUsdWhaleAddress = "0xf9a0106251467fff1ff03e8609aa74fc55a2a45e"

context("alUSD Feeder Pool integration to Alchemix", () => {
    let admin: Signer
    let deployer: Signer
    let governor: Signer
    let ethWhale: Signer
    let mUsdWhale: Signer
    let alUsdWhale: Signer
    let fundManager: Signer
    let delayedProxyAdmin: DelayedProxyAdmin
    let alUsdFp: FeederPool
    let vault: BoostedVault
    let musdToken: IERC20
    let alusdToken: IERC20
    let alcxToken: IERC20
    let mtaToken: IERC20
    let alchemixIntegration: AlchemixIntegration
    let alchemixStakingPools: IAlchemixStakingPools
    let poolId: BN
    let liquidator: Liquidator
    let rewardsDistributor: RewardsDistributorEth

    const firstMintAmount = simpleToExactAmount(10000)
    const secondMintAmount = simpleToExactAmount(2000)
    const approveAmount = firstMintAmount.add(secondMintAmount)

    const setup = async (blockNumber: number) => {
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
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        admin = await impersonate(delayedProxyAdminAddress)
        ethWhale = await impersonate(ethWhaleAddress)
        mUsdWhale = await impersonate(mUsdWhaleAddress)
        alUsdWhale = await impersonate(alUsdWhaleAddress)
        fundManager = await impersonate(fundManagerAddress)

        // send some Ether to addresses that need it
        await Promise.all(
            [alUsdWhaleAddress, governorAddress, mUsdWhaleAddress].map((recipient) =>
                ethWhale.sendTransaction({
                    to: recipient,
                    value: simpleToExactAmount(10),
                }),
            ),
        )

        delayedProxyAdmin = await DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
        musdToken = await IERC20__factory.connect(mUSD.address, deployer)
        alusdToken = await IERC20__factory.connect(alUSD.address, deployer)
        alcxToken = await IERC20__factory.connect(ALCX.address, deployer)
        mtaToken = await IERC20__factory.connect(MTA.address, deployer)
        alchemixStakingPools = await IAlchemixStakingPools__factory.connect(alchemixStakingPoolsAddress, deployer)
        poolId = (await alchemixStakingPools.tokenPoolIds(alUSD.address)).sub(1)
        liquidator = await Liquidator__factory.connect(liquidatorAddress, governor)
        rewardsDistributor = await RewardsDistributorEth__factory.connect(rewardsDistributorAddress, fundManager)
    }

    context("After Feeder Pool deployed but not integration or vault", () => {
        before("reset block number", async () => {
            // After Feeder Pool deployed but before the Alchemix integration and vault contracts were deployed
            await setup(12810000)
        })
        it("Test connectivity", async () => {
            const currentBlock = await ethers.provider.getBlockNumber()
            console.log(`Current block ${currentBlock}`)
            const startEther = await deployer.getBalance()
            console.log(`Deployer ${deployerAddress} has ${startEther} Ether`)
        })
        it("deploy alUSD Feeder Pool", async () => {
            const config = {
                a: BN.from(50),
                limits: {
                    min: simpleToExactAmount(10, 16),
                    max: simpleToExactAmount(90, 16),
                },
            }
            const fpData: FeederData = {
                mAsset: mUSD,
                fAsset: alUSD,
                name: "mUSD/alUSD Feeder Pool",
                symbol: "fPmUSD/alUSD",
                config,
            }
            alUsdFp = alUSD.feederPool
                ? FeederPool__factory.connect(alUSD.feederPool, deployer)
                : await deployFeederPool(deployer, fpData, chain)

            expect(await alUsdFp.name(), "name").to.eq(fpData.name)
            expect(await alUsdFp.symbol(), "symbol").to.eq(fpData.symbol)
        })
        it("Mint some mUSD/alUSD in the Feeder Pool", async () => {
            const alUsdBassetBefore = await alUsdFp.getBasset(alusdToken.address)
            const mUsdBassetBefore = await alUsdFp.getBasset(mUSD.address)

            expect(await alusdToken.balanceOf(alUsdFp.address), "alUSD bal before").to.eq(0)
            expect(await musdToken.balanceOf(alUsdFp.address), "mUSD bal before").to.eq(0)
            expect(await alUsdFp.balanceOf(alUsdWhaleAddress), "whale fp bal before").to.eq(0)

            // Transfer some mUSD to the alUSD whale so they can do a mintMulti (to get the pool started)
            await musdToken.connect(mUsdWhale).transfer(alUsdWhaleAddress, approveAmount)
            expect(await musdToken.balanceOf(alUsdWhaleAddress), "alUsdWhale's mUSD bal after").to.gte(approveAmount)

            await alusdToken.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
            await musdToken.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
            expect(await alusdToken.allowance(alUsdWhaleAddress, alUsdFp.address), "alUsdWhale's alUSD bal after").to.eq(
                constants.MaxUint256,
            )
            expect(await musdToken.allowance(alUsdWhaleAddress, alUsdFp.address), "alUsdWhale's mUSD bal after").to.eq(constants.MaxUint256)
            expect(await alusdToken.balanceOf(alUsdWhaleAddress), "alUsd whale alUSD bal before").gte(approveAmount)
            expect(await musdToken.balanceOf(alUsdWhaleAddress), "alUsd whale mUSD bal before").gte(approveAmount)

            await alUsdFp
                .connect(alUsdWhale)
                .mintMulti(
                    [alusdToken.address, mUSD.address],
                    [firstMintAmount, firstMintAmount],
                    firstMintAmount.mul(2).sub(1),
                    alUsdWhaleAddress,
                )

            const alUsdBassetAfter = await alUsdFp.getBasset(alusdToken.address)
            const mUsdBassetAfter = await alUsdFp.getBasset(mUSD.address)
            expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance").to.eq(
                alUsdBassetBefore.vaultData.vaultBalance.add(firstMintAmount),
            )
            expect(mUsdBassetAfter.vaultData.vaultBalance, "mUSD vault balance").to.eq(
                mUsdBassetBefore.vaultData.vaultBalance.add(firstMintAmount),
            )
            expect(await alUsdFp.balanceOf(alUsdWhaleAddress), "whale fp bal after").to.eq(firstMintAmount.mul(2).add(1))
        })
        describe("Boosted vault for fPmUSD/alUSD Feeder Pool", () => {
            it("deploy boosted staking vault", async () => {
                const vaultData: VaultData = {
                    boosted: true,
                    name: "v-mUSD/alUSD fPool Vault",
                    symbol: "v-fPmUSD/alUSD",
                    priceCoeff: simpleToExactAmount(1),
                    stakingToken: alUsdFp.address,
                    rewardToken: MTA.address,
                }

                vault = (await deployVault(deployer, vaultData)) as BoostedVault
            })
            it("Distribute MTA rewards to vault", async () => {
                const distributionAmount = simpleToExactAmount(20000)
                const fundManagerMtaBalBefore = await mtaToken.balanceOf(fundManagerAddress)
                expect(fundManagerMtaBalBefore, "fund manager mta bal before").to.gt(distributionAmount)

                await mtaToken.connect(fundManager).approve(rewardsDistributor.address, distributionAmount)
                await rewardsDistributor.connect(fundManager).distributeRewards([vault.address], [distributionAmount])

                expect(await mtaToken.balanceOf(fundManagerAddress), "fund manager mta bal before").to.eq(
                    fundManagerMtaBalBefore.sub(distributionAmount),
                )
            })
            it("stake fPmUSD/alUSD in vault", async () => {
                const stakeAmount = simpleToExactAmount(1000)
                expect(await vault.balanceOf(alUsdWhaleAddress), "whale v-fp bal before").to.eq(0)

                await alUsdFp.connect(alUsdWhale).approve(vault.address, stakeAmount)
                await vault.connect(alUsdWhale)["stake(uint256)"](stakeAmount)

                expect(await vault.balanceOf(alUsdWhaleAddress), "whale v-fp bal after").to.eq(stakeAmount)
            })
            it("whale claims MTA from vault", async () => {
                await increaseTime(ONE_DAY.mul(5))
                expect(await mtaToken.balanceOf(alUsdWhaleAddress), "whale mta bal before").to.eq(0)

                await vault.connect(alUsdWhale).claimReward()

                expect(await mtaToken.balanceOf(alUsdWhaleAddress), "whale mta bal after").to.gt(0)
            })
        })
        describe("Integration", () => {
            it("deploy Alchemix integration", async () => {
                alchemixIntegration = await deployContract<AlchemixIntegration>(
                    new AlchemixIntegration__factory(deployer),
                    "Alchemix alUSD Integration",
                    [nexusAddress, alUsdFp.address, ALCX.address, alchemixStakingPoolsAddress, alUSD.address],
                )

                expect(await alchemixIntegration.nexus(), "nexus").to.eq(nexusAddress)
                expect(await alchemixIntegration.lpAddress(), "lp (feeder pool)").to.eq(alUsdFp.address)
                expect(await alchemixIntegration.rewardToken(), "rewards token").to.eq(ALCX.address)
                expect(await alchemixIntegration.stakingPools(), "Alchemix staking pools").to.eq(alchemixStakingPoolsAddress)
                expect(await alchemixIntegration.poolId(), "pool id").to.eq(0)
                expect(await alchemixIntegration.bAsset(), "bAsset").to.eq(alUSD.address)
            })
            it("initialize Alchemix integration", async () => {
                expect(
                    await alusdToken.allowance(alchemixIntegration.address, alchemixStakingPools.address),
                    "integration alUSD allowance before",
                ).to.eq(0)
                expect(
                    await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress),
                    "integration ALCX allowance before",
                ).to.eq(0)

                await alchemixIntegration.initialize()

                expect(
                    await alusdToken.allowance(alchemixIntegration.address, alchemixStakingPools.address),
                    "integration alUSD allowance after",
                ).to.eq(MAX_UINT256)
                expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress), "integration ALCX allowance after").to.eq(
                    MAX_UINT256,
                )
            })
            it("Migrate alUSD Feeder Pool to the Alchemix integration", async () => {
                expect(await alusdToken.balanceOf(alUsdFp.address), "alUSD bal before").to.eq(firstMintAmount)
                expect(await alusdToken.balanceOf(alchemixIntegration.address), "alUSD integration bal before").to.eq(0)
                expect(await musdToken.balanceOf(alUsdFp.address), "mUSD bal before").to.eq(firstMintAmount)

                await alUsdFp.connect(governor).migrateBassets([alusdToken.address], alchemixIntegration.address)

                // The migration just moves the alUSD to the integration contract. It is not deposited into the staking pool yet.
                expect(await alusdToken.balanceOf(alUsdFp.address), "alUSD fp bal after").to.eq(0)
                expect(await alusdToken.balanceOf(alchemixIntegration.address), "alUSD integration bal after").to.eq(firstMintAmount)
                expect(await musdToken.balanceOf(alUsdFp.address), "mUSD bal after").to.eq(firstMintAmount)
                expect(
                    await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
                    "integration's alUSD deposited after",
                ).to.eq(0)
                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX after",
                ).to.eq(0)
            })
            it("Mint some mUSD/alUSD in the Feeder Pool", async () => {
                const alUsdBassetBefore = await alUsdFp.getBasset(alusdToken.address)
                const mUsdBassetBefore = await alUsdFp.getBasset(mUSD.address)

                expect(
                    await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
                    "integration's alUSD deposited before",
                ).to.eq(0)
                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX before",
                ).to.eq(0)

                await alUsdFp
                    .connect(alUsdWhale)
                    .mintMulti(
                        [alusdToken.address, mUSD.address],
                        [secondMintAmount, secondMintAmount],
                        secondMintAmount.mul(2).sub(1),
                        alUsdWhaleAddress,
                    )

                const alUsdBassetAfter = await alUsdFp.getBasset(alusdToken.address)
                const mUsdBassetAfter = await alUsdFp.getBasset(mUSD.address)
                expect(await alusdToken.balanceOf(alUsdFp.address), "alUSD fp bal after").to.eq(0)
                expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance after").to.eq(approveAmount)
                expect(mUsdBassetAfter.vaultData.vaultBalance, "mUSD vault balance after").to.eq(approveAmount)
                const cacheAmount = simpleToExactAmount(1000)
                expect(await alusdToken.balanceOf(alchemixIntegration.address), "alUSD integration bal after").to.eq(cacheAmount)
                expect(
                    await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
                    "integration's alUSD deposited after",
                ).to.eq(mUsdBassetBefore.vaultData.vaultBalance.add(secondMintAmount).sub(cacheAmount))
                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX after",
                ).to.eq(0)
            })
            it("accrue ALCX", async () => {
                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX before",
                ).to.eq(0)

                await increaseTime(ONE_WEEK)

                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX after",
                ).to.gt(simpleToExactAmount(1, 12))
            })
            it("redeem a lot of alUSD", async () => {
                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX before",
                ).to.gt(simpleToExactAmount(1, 12))
                expect(await alcxToken.balanceOf(alchemixIntegration.address), "integration ALCX bal before").to.eq(0)

                const redeemAmount = simpleToExactAmount(8000)
                await alUsdFp.connect(alUsdWhale).redeemExactBassets([alUSD.address], [redeemAmount], firstMintAmount, alUsdWhaleAddress)

                const alUsdBassetAfter = await alUsdFp.getBasset(alusdToken.address)
                expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance").to.eq(approveAmount.sub(redeemAmount))
                const integrationAlusdBalance = await alusdToken.balanceOf(alchemixIntegration.address)
                expect(integrationAlusdBalance, "alUSD in cache").to.gt(0)
                expect(
                    await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
                    "integration's alUSD deposited after",
                ).to.eq(approveAmount.sub(redeemAmount).sub(integrationAlusdBalance))
                // The withdraw from the staking pool sends accrued ALCX rewards to the integration contract
                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "integration's accrued ALCX after",
                ).to.eq(0)
                expect(await alcxToken.balanceOf(alchemixIntegration.address), "integration ALCX bal after").to.gt(
                    simpleToExactAmount(1, 12),
                )
            })
        })
        describe("liquidator", () => {
            let newLiquidatorImpl: Liquidator
            it("deploy new liquidator", async () => {
                newLiquidatorImpl = await deployContract(new Liquidator__factory(deployer), "Liquidator", [
                    nexusAddress,
                    stkAAVE.address,
                    AAVE.address,
                    uniswapRouterAddress,
                    uniswapQuoterAddress,
                    COMP.address,
                    ALCX.address,
                ])

                expect(await newLiquidatorImpl.nexus(), "nexus").to.eq(nexusAddress)
                expect(await newLiquidatorImpl.stkAave(), "stkAave").to.eq(stkAAVE.address)
                expect(await newLiquidatorImpl.aaveToken(), "aaveToken").to.eq(AAVE.address)
                expect(await newLiquidatorImpl.uniswapRouter(), "uniswapRouter").to.eq(uniswapRouterAddress)
                expect(await newLiquidatorImpl.uniswapQuoter(), "uniswapQuoter").to.eq(uniswapQuoterAddress)
                expect(await newLiquidatorImpl.compToken(), "compToken").to.eq(COMP.address)
                expect(await newLiquidatorImpl.alchemixToken(), "alchemixToken").to.eq(ALCX.address)
            })
            it("Upgrade the Liquidator proxy", async () => {
                const liquidatorProxy = LiquidatorProxy__factory.connect(liquidatorAddress, admin)
                expect(await liquidatorProxy.callStatic.admin(), "proxy admin before").to.eq(delayedProxyAdminAddress)
                expect(await liquidatorProxy.callStatic.implementation(), "liquidator impl address before").to.not.eq(
                    newLiquidatorImpl.address,
                )
                expect(await alcxToken.allowance(liquidator.address, uniswapRouterAddress), "ALCX allowance before").to.eq(0)

                // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
                const data = newLiquidatorImpl.interface.encodeFunctionData("upgrade")
                await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, newLiquidatorImpl.address, data)
                await increaseTime(ONE_WEEK.add(60))
                await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

                expect(await liquidatorProxy.callStatic.implementation(), "liquidator impl address after").to.eq(newLiquidatorImpl.address)
                expect(await alcxToken.allowance(liquidator.address, uniswapRouterAddress), "ALCX allowance after").to.eq(MAX_UINT256)
            })
            it("create liquidation of ALCX", async () => {
                const uniswapPath = encodeUniswapPath([ALCX.address, uniswapEthToken, DAI.address, alUSD.address], [10000, 3000, 500])
                await liquidator.createLiquidation(
                    alchemixIntegration.address,
                    ALCX.address,
                    alUSD.address,
                    uniswapPath.encoded,
                    uniswapPath.encodedReversed,
                    simpleToExactAmount(5000),
                    simpleToExactAmount(200),
                    ZERO_ADDRESS,
                    false,
                )
            })
            it("Claim accrued ALCX using integration contract", async () => {
                await increaseTime(ONE_WEEK)

                const unclaimedAlcxBefore = await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId)
                expect(unclaimedAlcxBefore, "some ALCX before").to.gt(0)
                const integrationAlcxBalanceBefore = await alcxToken.balanceOf(alchemixIntegration.address)

                await alchemixIntegration.claimRewards()

                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "unclaimed ALCX after",
                ).to.eq(0)
                const integrationAlcxBalanceAfter = await alcxToken.balanceOf(alchemixIntegration.address)
                expect(integrationAlcxBalanceAfter, "more ALCX").to.gt(integrationAlcxBalanceBefore)
                expect(await alcxToken.balanceOf(alchemixIntegration.address), "claimed ALCX").to.gte(
                    integrationAlcxBalanceBefore.add(unclaimedAlcxBefore),
                )
            })
            it("trigger ALCX liquidation", async () => {
                await liquidator.triggerLiquidation(alchemixIntegration.address)
            })
            it("trigger COMP liquidation", async () => {
                await liquidator.triggerLiquidation(USDC.integrator)
            })
            it("claim and liquidate stkAAVE", async () => {
                await liquidator.claimStakedAave()
                await increaseTime(ONE_DAY.mul(11))
                await liquidator.triggerLiquidationAave()
            })
        })
    })
    context("Before liquidator upgrade", () => {
        before("reset block number", async () => {
            // 14 July after alUSD Feeder Pool and integration is live
            await setup(12823000)

            alchemixIntegration = AlchemixIntegration__factory.connect(alUSD.integrator, deployer)
        })
        describe("liquidator", () => {
            let newLiquidatorImpl: Liquidator
            it("deploy new liquidator", async () => {
                newLiquidatorImpl = await deployContract(new Liquidator__factory(deployer), "Liquidator", [
                    nexusAddress,
                    stkAAVE.address,
                    AAVE.address,
                    uniswapRouterAddress,
                    uniswapQuoterAddress,
                    COMP.address,
                    ALCX.address,
                ])

                expect(await newLiquidatorImpl.nexus(), "nexus").to.eq(nexusAddress)
                expect(await newLiquidatorImpl.stkAave(), "stkAave").to.eq(stkAAVE.address)
                expect(await newLiquidatorImpl.aaveToken(), "aaveToken").to.eq(AAVE.address)
                expect(await newLiquidatorImpl.uniswapRouter(), "uniswapRouter").to.eq(uniswapRouterAddress)
                expect(await newLiquidatorImpl.uniswapQuoter(), "uniswapQuoter").to.eq(uniswapQuoterAddress)
                expect(await newLiquidatorImpl.compToken(), "compToken").to.eq(COMP.address)
                expect(await newLiquidatorImpl.alchemixToken(), "alchemixToken").to.eq(ALCX.address)
            })
            it("Upgrade the Liquidator proxy", async () => {
                const liquidatorProxy = LiquidatorProxy__factory.connect(liquidatorAddress, admin)
                expect(await liquidatorProxy.callStatic.admin(), "proxy admin before").to.eq(delayedProxyAdminAddress)
                expect(await liquidatorProxy.callStatic.implementation(), "liquidator impl address before").to.not.eq(
                    newLiquidatorImpl.address,
                )
                expect(await alcxToken.allowance(liquidator.address, uniswapRouterAddress), "ALCX allowance before").to.eq(0)

                // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
                const data = newLiquidatorImpl.interface.encodeFunctionData("upgrade")
                await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, newLiquidatorImpl.address, data)
                await increaseTime(ONE_WEEK.add(60))
                await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

                expect(await liquidatorProxy.callStatic.implementation(), "liquidator impl address after").to.eq(newLiquidatorImpl.address)
                expect(await alcxToken.allowance(liquidator.address, uniswapRouterAddress), "ALCX allowance after").to.eq(MAX_UINT256)
            })
            it("create liquidation of ALCX", async () => {
                const uniswapPath = encodeUniswapPath([ALCX.address, uniswapEthToken, DAI.address, alUSD.address], [10000, 3000, 500])
                await liquidator.createLiquidation(
                    alchemixIntegration.address,
                    ALCX.address,
                    alUSD.address,
                    uniswapPath.encoded,
                    uniswapPath.encodedReversed,
                    simpleToExactAmount(5000),
                    simpleToExactAmount(200),
                    ZERO_ADDRESS,
                    false,
                )
            })
            it("Claim accrued ALCX using integration contract", async () => {
                const unclaimedAlcxBefore = await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId)
                expect(unclaimedAlcxBefore, "some ALCX before").to.gt(0)
                const integrationAlcxBalanceBefore = await alcxToken.balanceOf(alchemixIntegration.address)

                await alchemixIntegration.claimRewards()

                expect(
                    await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
                    "unclaimed ALCX after",
                ).to.eq(0)
                const integrationAlcxBalanceAfter = await alcxToken.balanceOf(alchemixIntegration.address)
                expect(integrationAlcxBalanceAfter, "more ALCX").to.gt(integrationAlcxBalanceBefore)
                // TODO why can't I get the correct amount?
                console.log(
                    `${await alcxToken.balanceOf(
                        alchemixIntegration.address,
                    )} integration after = ${integrationAlcxBalanceBefore} integration before + ${unclaimedAlcxBefore}`,
                )
                expect(await alcxToken.balanceOf(alchemixIntegration.address), "claimed ALCX").to.gte(
                    integrationAlcxBalanceBefore.add(unclaimedAlcxBefore),
                )
            })
            it("trigger ALCX liquidation", async () => {
                await liquidator.triggerLiquidation(alchemixIntegration.address)
            })
            it("trigger COMP liquidation", async () => {
                await liquidator.triggerLiquidation(USDC.integrator)
            })
            it("claim and liquidate stkAAVE", async () => {
                // Have already waited 7 days for the proxy upgrade so the stkAAVE should be ready to redeem
                await liquidator.triggerLiquidationAave()
                await liquidator.claimStakedAave()
            })
        })
    })
})
