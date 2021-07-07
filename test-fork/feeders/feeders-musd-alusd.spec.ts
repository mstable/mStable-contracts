import { impersonate } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { Signer, constants } from "ethers"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import { FeederPool, FeederPool__factory, IERC20, IERC20__factory, Masset__factory } from "types/generated"
import { AlchemixIntegration } from "types/generated/AlchemixIntegration"
import { AlchemixIntegration__factory } from "types/generated/factories/AlchemixIntegration__factory"

const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x69E0E2b3d523D3b247d798a49C3fa022a46DD6bd"
const alUsdWhaleAddress = "0xf9a0106251467fff1ff03e8609aa74fc55a2a45e"

const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3"
const mUsdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5"
const alUsdAddress = "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9"
const alcxAddress = "0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF"
const stakingPoolsAddress = "0xAB8e74017a8Cc7c15FFcCd726603790d26d7DeCa"
const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD"

context("mUSD Feeder Pool integration to Alchemix", () => {
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

        mUsd = await IERC20__factory.connect(mUsdAddress, deployer)
        alUsd = await IERC20__factory.connect(alUsdAddress, deployer)
        alcxToken = await IERC20__factory.connect(alcxAddress, deployer)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await deployer.getBalance()
        console.log(`Deployer ${deployerAddress} has ${startEther} Ether`)
    })
    it("deploy and initialize integration contract", async () => {
        alUsdFp = await deployContract<FeederPool>(
            new FeederPool__factory(
                {
                    __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: "0x90aE544E8cc76d2867987Ee4f5456C02C50aBd8B", // FeederManager
                    __$7791d1d5b7ea16da359ce352a2ac3a881c$__: "0x2837C77527c37d61D9763F53005211dACB4125dE", // FeederLogic
                },
                deployer,
            ),
            "alUSD/mUSD Feeder Pool",
            [nexusAddress, mUsdAddress],
        )

        const mpAssets = (await Masset__factory.connect(mUsdAddress, deployer).getBassets())[0].map((p) => p[0])

        await alUsdFp.initialize(
            "Feeder Pool mUSD/alUSD",
            "fP-mUSD/alUSD",
            { addr: mUsdAddress, integrator: constants.AddressZero, hasTxFee: false, status: 0 },
            { addr: alUsdAddress, integrator: constants.AddressZero, hasTxFee: false, status: 0 },
            mpAssets,
            {
                a: BN.from(225),
                limits: {
                    min: simpleToExactAmount(10, 16),
                    max: simpleToExactAmount(90, 16),
                },
            },
        )

        alchemixIntegration = await deployContract<AlchemixIntegration>(
            new AlchemixIntegration__factory(deployer),
            "Alchemix alUSD Integration",
            [nexusAddress, alUsdFp.address, alcxAddress, stakingPoolsAddress],
        )
        expect(alchemixIntegration.address).to.length(42)

        await alchemixIntegration.initialize([alUsdAddress], [alcxAddress])
    })
    it("Governor approves Liquidator to spend the reward (ALCX) token", async () => {
        expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress)).to.eq(0)

        // This will be done via the delayedProxyAdmin on mainnet
        await alchemixIntegration.connect(governor).approveRewardToken()

        expect(await alcxToken.allowance(alchemixIntegration.address, liquidatorAddress)).to.eq(constants.MaxUint256)
    })
    it("Mint some mUSD/alUSD in the Feeder Pool", async () => {
        const alUsdBassetBefore = await alUsdFp.getBasset(alUsdAddress)
        const mUsdBassetBefore = await alUsdFp.getBasset(mUsdAddress)

        expect(await alUsd.balanceOf(alUsdFp.address)).to.eq(0)
        expect(await mUsd.balanceOf(alUsdFp.address)).to.eq(0)

        const mintAmount = simpleToExactAmount(10000)

        // Transfer some mUSD to the alUSD whale so they can do a mintMulti (to get the pool started)
        await mUsd.connect(mUsdWhale).transfer(alUsdWhaleAddress, mintAmount)
        expect(await mUsd.balanceOf(alUsdWhaleAddress)).to.gte(mintAmount)

        await alUsd.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
        await mUsd.connect(alUsdWhale).approve(alUsdFp.address, constants.MaxUint256)
        expect(await alUsd.allowance(alUsdWhaleAddress, alUsdFp.address)).to.eq(constants.MaxUint256)
        expect(await mUsd.allowance(alUsdWhaleAddress, alUsdFp.address)).to.eq(constants.MaxUint256)

        await alUsdFp.connect(alUsdWhale).mintMulti([alUsdAddress, mUsdAddress], [mintAmount, mintAmount], 0, alUsdWhaleAddress)

        const alUsdBassetAfter = await alUsdFp.getBasset(alUsdAddress)
        const mUsdBassetAfter = await alUsdFp.getBasset(mUsdAddress)
        expect(alUsdBassetAfter.vaultData.vaultBalance, "alUSD vault balance").to.eq(
            alUsdBassetBefore.vaultData.vaultBalance.add(mintAmount),
        )
        expect(mUsdBassetAfter.vaultData.vaultBalance, "mUSD vault balance").to.eq(mUsdBassetBefore.vaultData.vaultBalance.add(mintAmount))
    })
    it("Migrate alUSD to the Alchemix integration", async () => {
        expect(await alUsd.balanceOf(alUsdFp.address), "Some alUSD in Feeder Pool").to.gt(0)
        expect(await alUsd.balanceOf(alchemixIntegration.address), "No alUSD in Integration contract").to.eq(0)
        const alUsdInFpBefore = await alUsd.balanceOf(alUsdFp.address)

        // Migrate the alUSD
        await alUsdFp.migrateBassets([alUsdAddress], alchemixIntegration.address)

        // All alUSD in the FP should have moved to the integration contract
        expect(await alUsd.balanceOf(alchemixIntegration.address), "All alUSD in FP migrated to Integration").to.eq(alUsdInFpBefore)
        expect(await alUsd.balanceOf(alUsdFp.address), "No more alUSD in Feeder Pool").to.eq(0)
    })
    // Mint alUSD in FP, test integration/FP balances, wait for a block or two, claim rewards
    // Liquidate rewards and test output/balances
})
