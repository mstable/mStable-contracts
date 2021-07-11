import { ONE_WEEK } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Signer, constants } from "ethers"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import { deployFeederPool, FeederData } from "tasks/utils/feederUtils"
import { getChainAddress } from "tasks/utils/networkAddressFactory"
import { ALCX, alUSD, Chain, mUSD } from "tasks/utils/tokens"
import { FeederPool, IERC20, IERC20__factory } from "types/generated"
import { AlchemixIntegration } from "types/generated/AlchemixIntegration"
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

context("alUSD Feeder Pool integration to Alchemix", () => {
    let governor: Signer
    let deployer: Signer
    let ethWhale: Signer
    let mUsdWhale: Signer
    let alUsdWhale: Signer
    let alUsdFp: FeederPool
    let mUsd: IERC20
    let alUsd: IERC20
    let alcxToken: IERC20
    let alchemixIntegration: AlchemixIntegration
    let alchemixStakingPools: IAlchemixStakingPools
    let poolId: BN

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

        mUsd = await IERC20__factory.connect(mUSD.address, deployer)
        alUsd = await IERC20__factory.connect(alUSD.address, deployer)
        alcxToken = await IERC20__factory.connect(ALCX.address, deployer)
        alchemixStakingPools = await IAlchemixStakingPools__factory.connect(alchemixStakingPoolsAddress, deployer)
        poolId = (await alchemixStakingPools.tokenPoolIds(alUSD.address)).sub(1)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await deployer.getBalance()
        console.log(`Deployer ${deployerAddress} has ${startEther} Ether`)
    })
    it("deploy alUSD Feeder Pool", async () => {
        const config = {
            a: BN.from(225),
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
            [nexusAddress, alUsdFp.address, ALCX.address, alchemixStakingPoolsAddress],
        )

        expect(await alchemixIntegration.nexus(), "nexus").to.eq(nexusAddress)
        expect(await alchemixIntegration.lpAddress(), "lp (feeder pool)").to.eq(alUsdFp.address)
        expect(await alchemixIntegration.rewardToken(), "rewards token").to.eq(ALCX.address)
        expect(await alchemixIntegration.stakingPools(), "Alchemix staking pools").to.eq(alchemixStakingPoolsAddress)

        await alchemixIntegration.initialize([alUSD.address])

        expect(await alchemixIntegration.bAssetToPoolId(alUSD.address)).to.eq(0)
    })
    it("Migrate alUSD Feeder Pool to the Alchemix integration", async () => {
        // Migrate the alUSD
        await alUsdFp.connect(governor).migrateBassets([alUsd.address], alchemixIntegration.address)
    })
    it("Governor approves Liquidator to spend the reward (ALCX) token", async () => {
        expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress)).to.eq(0)

        // This will be done via the delayedProxyAdmin on mainnet
        await alchemixIntegration.connect(governor).approveRewardToken()

        expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress)).to.eq(constants.MaxUint256)
    })
    it("Mint some mUSD/alUSD in the Feeder Pool", async () => {
        const alUsdBassetBefore = await alUsdFp.getBasset(alUsd.address)
        const mUsdBassetBefore = await alUsdFp.getBasset(mUSD.address)

        expect(await alUsd.balanceOf(alUsdFp.address), "alUSD bal before").to.eq(0)
        expect(await mUsd.balanceOf(alUsdFp.address), "mUSD bal before").to.eq(0)
        expect(
            await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
            "integration's alUSD deposited before",
        ).to.eq(0)
        expect(
            await alchemixStakingPools.getStakeTotalUnclaimed(alchemixIntegration.address, poolId),
            "integration's accrued ALCX before",
        ).to.eq(0)

        // Transfer some mUSD to the alUSD whale so they can do a mintMulti (to get the pool started)
        await mUsd.connect(mUsdWhale).transfer(alUsdWhaleAddress, mintAmount)
        expect(await mUsd.balanceOf(alUsdWhaleAddress), "alUsdWhale's mUSD bal after").to.gte(mintAmount)

        await alUsd.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
        await mUsd.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
        expect(await alUsd.allowance(alUsdWhaleAddress, alUsdFp.address), "alUsdWhale's alUSD bal after").to.eq(constants.MaxUint256)
        expect(await mUsd.allowance(alUsdWhaleAddress, alUsdFp.address), "alUsdWhale's mUSD bal after").to.eq(constants.MaxUint256)
        expect(await alUsd.balanceOf(alUsdWhaleAddress), "alUsd whale alUSD bal before").gte(mintAmount)
        expect(await mUsd.balanceOf(alUsdWhaleAddress), "alUsd whale mUSD bal before").gte(mintAmount)

        await alUsdFp
            .connect(alUsdWhale)
            .mintMulti([alUsd.address, mUSD.address], [mintAmount, mintAmount], mintAmount.sub(1), alUsdWhaleAddress)

        const alUsdBassetAfter = await alUsdFp.getBasset(alUsd.address)
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
        ).to.gt(0)
    })
    it("redeem a lot of alUSD", async () => {
        const redeemAmount = simpleToExactAmount(8000)
        await alUsdFp.connect(alUsdWhale).redeemExactBassets([alUSD.address], [redeemAmount], mintAmount, alUsdWhaleAddress)

        const alUsdBassetAfter = await alUsdFp.getBasset(alUsd.address)
        expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance").to.eq(mintAmount.sub(redeemAmount))
        const integrationAlusdBalance = await alUsd.balanceOf(alchemixIntegration.address)
        expect(integrationAlusdBalance, "alUSD in cache").to.gt(0)
        expect(
            await alchemixStakingPools.getStakeTotalDeposited(alchemixIntegration.address, poolId),
            "integration's alUSD deposited after",
        ).to.eq(mintAmount.sub(redeemAmount).sub(integrationAlusdBalance))
    })
    // Mint alUSD in FP, test integration/FP balances, wait for a block or two, claim rewards
    // Liquidate rewards and test output/balances
})
