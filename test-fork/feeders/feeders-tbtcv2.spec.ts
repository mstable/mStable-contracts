import { impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import { ZERO_ADDRESS } from "index"
import { Chain, deployContract, mBTC, MTA, TBTCv2 } from "tasks/utils"
import { getChainAddress, resolveAddress } from "tasks/utils/networkAddressFactory"
import { Account } from "types"
import {
    AssetProxy__factory,
    BoostedDualVaultTBTCv2,
    BoostedDualVaultTBTCv2__factory,
    ERC20,
    ERC20__factory,
    FeederPool,
    FeederPool__factory,
    MockERC20__factory,
    RewardsDistributorEth,
    RewardsDistributorEth__factory,
    SavingsManager,
} from "types/generated"

context("TBTCv2 Feeder Pool", () => {
    let tbtcV2whale: Account
    let mbtcWhale: Account
    let governor: Account
    let ops: Account
    let tbtcv2: ERC20
    let tbtcv2Fp: FeederPool
    let mbtc: ERC20
    let rewardsToken: ERC20
    let platformToken: ERC20
    let vault: BoostedDualVaultTBTCv2
    let rewardsDistributor: RewardsDistributorEth

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13485000,
                    },
                },
            ],
        })
        ops = await impersonateAccount(resolveAddress("OperationsSigner"))
        governor = await impersonateAccount(resolveAddress("Governor"))
        tbtcV2whale = await impersonateAccount("0x9eef87f4c08d8934cb2a3309df4dec5635338115")
        mbtcWhale = await impersonateAccount("0x15a295e9bcfcf93a8721dcb9a19330fc59771271")

        tbtcv2 = ERC20__factory.connect(TBTCv2.address, tbtcV2whale.signer)
        mbtc = ERC20__factory.connect(mBTC.address, mbtcWhale.signer)
        tbtcv2Fp = FeederPool__factory.connect(TBTCv2.feederPool, tbtcV2whale.signer)
        rewardsToken = ERC20__factory.connect(MTA.address, ops.signer)
        platformToken = await deployContract(new MockERC20__factory(ops.signer), "Platform Token", [
            "Platform Token",
            "PT",
            18,
            ops.address,
            simpleToExactAmount(10000),
        ])
        const rewardsDistributorAddress = getChainAddress("RewardsDistributor", Chain.mainnet)
        rewardsDistributor = RewardsDistributorEth__factory.connect(rewardsDistributorAddress, ops.signer)

        await mbtc.transfer(tbtcV2whale.address, simpleToExactAmount(2))
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await tbtcV2whale.signer.getBalance()
        console.log(`Deployer ${tbtcV2whale} has ${startEther} Ether`)
    })
    it("Approve spend of TBTCv2", async () => {
        expect(await tbtcv2.allowance(tbtcV2whale.address, TBTCv2.feederPool), "Allowance before").to.eq(0)
        const approveAmount = simpleToExactAmount(2)
        await tbtcv2.approve(TBTCv2.feederPool, approveAmount)
        expect(await tbtcv2.allowance(tbtcV2whale.address, TBTCv2.feederPool), "Allowance after").to.eq(approveAmount)
    })
    it("Approve spend of mBTC", async () => {
        expect(await mbtc.allowance(tbtcV2whale.address, TBTCv2.feederPool), "Allowance before").to.eq(0)
        const approveAmount = simpleToExactAmount(2)
        await mbtc.connect(tbtcV2whale.signer).approve(TBTCv2.feederPool, approveAmount)
        expect(await mbtc.allowance(tbtcV2whale.address, TBTCv2.feederPool), "Allowance after").to.eq(approveAmount)
    })
    it("Mint TBTCv2 Feeder Pool", async () => {
        const bAssetAmount = simpleToExactAmount(1)
        const minAmount = simpleToExactAmount("1.9")
        expect(await tbtcv2.balanceOf(tbtcV2whale.address), "TBTCv2 balance before").to.gt(bAssetAmount)
        expect(await mbtc.balanceOf(tbtcV2whale.address), "mBTC balance before").to.gt(bAssetAmount)
        expect(await tbtcv2Fp.balanceOf(tbtcV2whale.address), "TBTCv2Fp balance before").to.eq(0)
        expect(await tbtcv2Fp.totalSupply(), "totalSupply before").to.eq(800000000000001)

        await tbtcv2Fp.mintMulti([TBTCv2.address, mBTC.address], [bAssetAmount, bAssetAmount], minAmount, tbtcV2whale.address)

        expect(await tbtcv2Fp.balanceOf(tbtcV2whale.address), "TBTCv2Fp balance after").to.gt(minAmount)
        expect(await tbtcv2Fp.totalSupply(), "totalSupply after").to.gt(minAmount)
    })
    it("Deploy tBTCv2 Vault", async () => {
        const rewardsDistributorAddress = getChainAddress("RewardsDistributor", Chain.mainnet)
        const constructorArguments = [
            getChainAddress("Nexus", Chain.mainnet),
            TBTCv2.feederPool,
            getChainAddress("BoostDirector", Chain.mainnet),
            simpleToExactAmount(48000),
            48,
            MTA.address,
        ]
        const vaultImpl = await deployContract(
            new BoostedDualVaultTBTCv2__factory(ops.signer),
            "BoostedDualVaultTBTCv2",
            constructorArguments,
        )

        const initializeData = vaultImpl.interface.encodeFunctionData("initialize", [
            rewardsDistributorAddress,
            "v-mBTC/tBTCv2 fPool Vault",
            "v-fPmBTC/tBTCv2",
        ])
        const proxyAdminAddress = getChainAddress("DelayedProxyAdmin", Chain.mainnet)

        // Proxy
        const proxy = await deployContract(new AssetProxy__factory(ops.signer), "AssetProxy for vault", [
            vaultImpl.address,
            proxyAdminAddress,
            initializeData,
        ])

        vault = BoostedDualVaultTBTCv2__factory.connect(proxy.address, tbtcV2whale.signer)
    })
    it("Deposit into vault", async () => {
        const stakeAmount = simpleToExactAmount("0.5")
        expect(await vault.balanceOf(tbtcV2whale.address), "staked before").to.eq(0)
        expect(await tbtcv2Fp.balanceOf(tbtcV2whale.address), "fp before").to.gt(stakeAmount)

        await tbtcv2Fp.connect(tbtcV2whale.signer).approve(vault.address, simpleToExactAmount(2))

        await vault.connect(tbtcV2whale.signer)["stake(uint256)"](stakeAmount)

        expect(await vault.balanceOf(tbtcV2whale.address), "staked after").to.eq(stakeAmount)
    })
    it("distribute MTA to vault", async () => {
        expect(await rewardsToken.balanceOf(vault.address), "vault rewards before").to.eq(0)
        const distAmount = simpleToExactAmount(1000)

        await rewardsDistributor.distributeRewards([vault.address], [distAmount])

        expect(await rewardsToken.balanceOf(vault.address), "vault rewards after").to.eq(distAmount)
    })
    it("Set platform token", async () => {
        expect(await vault.platformToken(), "platform token before").to.eq(ZERO_ADDRESS)

        await vault.connect(governor.signer).setPlatformToken(platformToken.address)

        expect(await vault.platformToken(), "platform token after").to.eq(platformToken.address)
    })
    it("distribute MTA and Platform Token to vault", async () => {
        const platformTokenVendorAddress = await vault.platformTokenVendor()
        expect(await rewardsToken.balanceOf(vault.address), "vault rewards before").to.eq(simpleToExactAmount(1000))
        expect(await platformToken.balanceOf(platformTokenVendorAddress), "vault platform tokens before").to.eq(0)
        await platformToken.transfer(vault.address, simpleToExactAmount(100))

        await rewardsDistributor.distributeRewards([vault.address], [simpleToExactAmount(2000)])

        expect(await rewardsToken.balanceOf(vault.address), "vault rewards after").to.eq(simpleToExactAmount(3000))
        expect(await platformToken.balanceOf(platformTokenVendorAddress), "vault platform tokens after").to.eq(simpleToExactAmount(100))
    })
})
