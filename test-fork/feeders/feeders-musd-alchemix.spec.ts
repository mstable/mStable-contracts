import { assertBNClose } from "@utils/assertions"
import { MAX_UINT256, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Signer, constants } from "ethers"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import { deployFeederPool, FeederData } from "tasks/utils/feederUtils"
import { getChainAddress } from "tasks/utils/networkAddressFactory"
import { AAVE, ALCX, alUSD, Chain, COMP, mUSD, stkAAVE } from "tasks/utils/tokens"
import {
    AlchemixIntegration,
    FeederPool,
    IERC20,
    IERC20__factory,
    Liquidator,
    LiquidatorProxy__factory,
    Liquidator__factory,
} from "types/generated"
import { AlchemixIntegration__factory } from "types/generated/factories/AlchemixIntegration__factory"
import { IAlchemixStakingPools__factory } from "types/generated/factories/IAlchemixStakingPools__factory"
import { IAlchemixStakingPools } from "types/generated/IAlchemixStakingPools"

const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x69E0E2b3d523D3b247d798a49C3fa022a46DD6bd"
const alUsdWhaleAddress = "0xf9a0106251467fff1ff03e8609aa74fc55a2a45e"

const chain = Chain.mainnet
const nexusAddress = getChainAddress("Nexus", chain)
const liquidatorAddress = getChainAddress("Liquidator", chain)
const alchemixStakingPoolsAddress = getChainAddress("AlchemixStakingPool", chain)
const uniswapRouterAddress = getChainAddress("UniswapRouterV3", chain)
const uniswapQuoterAddress = getChainAddress("UniswapQuoterV3", chain)
const uniswapEthToken = getChainAddress("UniswapEthToken", Chain.mainnet)

context("alUSD Feeder Pool integration to Alchemix", () => {
    let governor: Signer
    let deployer: Signer
    let ethWhale: Signer
    let mUsdWhale: Signer
    let alUsdWhale: Signer
    let alUsdFp: FeederPool
    let musdToken: IERC20
    let alusdToken: IERC20
    let alcxToken: IERC20
    let alchemixIntegration: AlchemixIntegration
    let alchemixStakingPools: IAlchemixStakingPools
    let poolId: BN
    let liquidator: Liquidator

    const mintAmount = simpleToExactAmount(10000)

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12779756,
                    },
                },
            ],
        })
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        ethWhale = await impersonate(ethWhaleAddress)
        mUsdWhale = await impersonate(mUsdWhaleAddress)
        alUsdWhale = await impersonate(alUsdWhaleAddress)

        // send some Ether to addresses that need it
        await Promise.all(
            [alUsdWhaleAddress, governorAddress, mUsdWhaleAddress].map((recipient) =>
                ethWhale.sendTransaction({
                    to: recipient,
                    value: simpleToExactAmount(10),
                }),
            ),
        )

        musdToken = await IERC20__factory.connect(mUSD.address, deployer)
        alusdToken = await IERC20__factory.connect(alUSD.address, deployer)
        alcxToken = await IERC20__factory.connect(ALCX.address, deployer)
        alchemixStakingPools = await IAlchemixStakingPools__factory.connect(alchemixStakingPoolsAddress, deployer)
        poolId = (await alchemixStakingPools.tokenPoolIds(alUSD.address)).sub(1)
        liquidator = await Liquidator__factory.connect(liquidatorAddress, governor)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await deployer.getBalance()
        console.log(`Deployer ${deployerAddress} has ${startEther} Ether`)
    })
    it("deploy alUSD Feeder Pool", async () => {
        const config = {
            a: BN.from(60),
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

        alUsdFp = await deployFeederPool(deployer, fpData, chain)

        expect(await alUsdFp.name(), "name").to.eq(fpData.name)
        expect(await alUsdFp.symbol(), "symbol").to.eq(fpData.symbol)
    })
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
        expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress), "integration ALCX allowance before").to.eq(0)

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
        // Migrate the alUSD
        await alUsdFp.connect(governor).migrateBassets([alusdToken.address], alchemixIntegration.address)
    })
    it("Governor approves Liquidator to spend the reward (ALCX) token", async () => {
        // expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress)).to.eq(0)

        // This will be done via the delayedProxyAdmin on mainnet
        await alchemixIntegration.connect(governor).reapproveContracts()

        expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress)).to.eq(constants.MaxUint256)
    })
    it("Mint some mUSD/alUSD in the Feeder Pool", async () => {
        const alUsdBassetBefore = await alUsdFp.getBasset(alusdToken.address)
        const mUsdBassetBefore = await alUsdFp.getBasset(mUSD.address)

        expect(await alusdToken.balanceOf(alUsdFp.address), "alUSD bal before").to.eq(0)
        expect(await musdToken.balanceOf(alUsdFp.address), "mUSD bal before").to.eq(0)
        expect(
            await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
            "integration's alUSD deposited before",
        ).to.eq(0)
        expect(
            await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
            "integration's accrued ALCX before",
        ).to.eq(0)

        // Transfer some mUSD to the alUSD whale so they can do a mintMulti (to get the pool started)
        await musdToken.connect(mUsdWhale).transfer(alUsdWhaleAddress, mintAmount)
        expect(await musdToken.balanceOf(alUsdWhaleAddress), "alUsdWhale's mUSD bal after").to.gte(mintAmount)

        await alusdToken.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
        await musdToken.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
        expect(await alusdToken.allowance(alUsdWhaleAddress, alUsdFp.address), "alUsdWhale's alUSD bal after").to.eq(constants.MaxUint256)
        expect(await musdToken.allowance(alUsdWhaleAddress, alUsdFp.address), "alUsdWhale's mUSD bal after").to.eq(constants.MaxUint256)
        expect(await alusdToken.balanceOf(alUsdWhaleAddress), "alUsd whale alUSD bal before").gte(mintAmount)
        expect(await musdToken.balanceOf(alUsdWhaleAddress), "alUsd whale mUSD bal before").gte(mintAmount)

        await alUsdFp
            .connect(alUsdWhale)
            .mintMulti([alusdToken.address, mUSD.address], [mintAmount, mintAmount], mintAmount.sub(1), alUsdWhaleAddress)

        const alUsdBassetAfter = await alUsdFp.getBasset(alusdToken.address)
        const mUsdBassetAfter = await alUsdFp.getBasset(mUSD.address)
        expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance").to.eq(
            alUsdBassetBefore.vaultData.vaultBalance.add(mintAmount),
        )
        expect(mUsdBassetAfter.vaultData.vaultBalance, "mUSD vault balance").to.eq(mUsdBassetBefore.vaultData.vaultBalance.add(mintAmount))

        expect(
            await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
            "integration's alUSD deposited after",
        ).to.eq(mintAmount)
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
            await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
            "integration's alUSD deposited after",
        ).to.eq(mintAmount)
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
        const redeemAmount = simpleToExactAmount(8000)

        await alUsdFp.connect(alUsdWhale).redeemExactBassets([alUSD.address], [redeemAmount], mintAmount, alUsdWhaleAddress)

        const alUsdBassetAfter = await alUsdFp.getBasset(alusdToken.address)
        expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance").to.eq(mintAmount.sub(redeemAmount))
        const integrationAlusdBalance = await alusdToken.balanceOf(alchemixIntegration.address)
        expect(integrationAlusdBalance, "alUSD in cache").to.gt(0)
        expect(
            await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
            "integration's alUSD deposited after",
        ).to.eq(mintAmount.sub(redeemAmount).sub(integrationAlusdBalance))
        expect(
            await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
            "integration's accrued ALCX after",
        ).to.eq(0)
    })
    it("Claim accrued ALCX rewards", async () => {
        await increaseTime(ONE_WEEK)

        const unclaimedAlcxBefore = await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId)
        const integrationAlusdBalanceBefore = await alusdToken.balanceOf(alchemixIntegration.address)
        expect(unclaimedAlcxBefore, "unclaimed ALCX before").to.gt(simpleToExactAmount(1, 10))
        expect(integrationAlusdBalanceBefore, "integration alUSD balance before").to.gt(0)

        await alchemixIntegration.claimRewards()

        expect(await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId), "unclaimed ALCX after").to.eq(0)
        // TODO fix these checks
        // expect(await alusdToken.balanceOf(alchemixIntegration.address), "integration alUSD balance after").to.eq(
        //     integrationAlusdBalanceBefore.add(unclaimedAlcxBefore),
        // )
        // assertBNClose(
        //     await alusdToken.balanceOf(alchemixIntegration.address),
        //     integrationAlusdBalanceBefore.add(unclaimedAlcxBefore),
        //     BN.from(1000),
        // )
    })
    describe.skip("liquidator", () => {
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
        it("upgrade liquidator proxy", async () => {
            const liquidatorProxy = LiquidatorProxy__factory.connect(liquidatorAddress, governor)
            expect(liquidatorProxy.admin(), "admin before").to.eq(governorAddress)

            await liquidatorProxy.upgradeTo(newLiquidatorImpl.address)

            expect(await liquidatorProxy.implementation(), "liquidator impl address").to.eq(newLiquidatorImpl.address)
        })
        it("upgrade liquidator", async () => {
            await liquidator.upgrade()
        })
        it("create liquidation of ALCX", async () => {
            const uniswapPath = encodeUniswapPath([ALCX.address, uniswapEthToken, alUSD.address], [3000, 3000])
            await liquidator.createLiquidation(
                alchemixIntegration.address,
                ALCX.address,
                alUSD.address,
                uniswapPath.encoded,
                uniswapPath.encodedReversed,
                simpleToExactAmount(5000),
                200,
                ZERO_ADDRESS,
                false,
            )
        })
        it("trigger ALCX liquidation", async () => {
            await liquidator.triggerLiquidation(alchemixIntegration.address)
        })
        // liquidate COMP
        // claim stkAAVE
        // liquidate stkAAVE
    })
})
