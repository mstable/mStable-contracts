import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
// import { BoostedSavingsVaultImusdMainnet1__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet1__factory"
// import { BoostedSavingsVaultImusdMainnet1 } from "types/generated/BoostedSavingsVaultImusdMainnet1"
// import { BoostedSavingsVaultImusdMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet2__factory"
// import { BoostedSavingsVaultImusdMainnet2 } from "types/generated/BoostedSavingsVaultImusdMainnet2"
// import { BoostedSavingsVaultImbtcMainnet1__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet1__factory"
// import { BoostedSavingsVaultImbtcMainnet1 } from "types/generated/BoostedSavingsVaultImbtcMainnet1"

// import { StakingRewardsWithPlatformTokenImusdPolygon1__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon1__factory"
// import { StakingRewardsWithPlatformTokenImusdPolygon1 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon1"
// import { StakingRewardsWithPlatformTokenImusdPolygon2__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon2__factory"
// import { StakingRewardsWithPlatformTokenImusdPolygon2 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon2"
// import { SavingsContractImusdMainnet20__factory } from "types/generated/factories/SavingsContractImusdMainnet20__factory"
// import { SavingsContractImusdMainnet20 } from "types/generated/SavingsContractImusdMainnet20"
// import { SavingsContractImusdMainnet21__factory } from "types/generated/factories/SavingsContractImusdMainnet21__factory"
// import { SavingsContractImusdMainnet21 } from "types/generated/SavingsContractImusdMainnet21"
// import { SavingsContractImbtcMainnet20__factory } from "types/generated/factories/SavingsContractImbtcMainnet20__factory"
// import { SavingsContractImbtcMainnet20 } from "types/generated/SavingsContractImbtcMainnet20"
// import { SavingsContractImusdPolygon20__factory } from "types/generated/factories/SavingsContractImusdPolygon20__factory"
// import { SavingsContractImusdPolygon20 } from "types/generated/SavingsContractImusdPolygon20"
// import { SavingsContractImusdPolygon21__factory } from "types/generated/factories/SavingsContractImusdPolygon21__factory"

import { SavingsContractImbtcMainnet21__factory } from "types/generated/factories/SavingsContractImbtcMainnet21__factory"
import { SavingsContractImbtcMainnet21 } from "types/generated/SavingsContractImbtcMainnet21"

import { BoostedSavingsVaultImbtcMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet2__factory"
import { BoostedSavingsVaultImbtcMainnet2 } from "types/generated/BoostedSavingsVaultImbtcMainnet2"

import { SavingsContractImusdMainnet21__factory } from "types/generated/factories/SavingsContractImusdMainnet21__factory"
import { SavingsContractImusdMainnet21 } from "types/generated/SavingsContractImusdMainnet21"

import { SavingsContractImusdPolygon21__factory } from "types/generated/factories/SavingsContractImusdPolygon21__factory"
import { SavingsContractImusdPolygon21 } from "types/generated/SavingsContractImusdPolygon21"

import { BoostedSavingsVaultImusdMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet2__factory"
import { BoostedSavingsVaultImusdMainnet2 } from "types/generated/BoostedSavingsVaultImusdMainnet2"

import { StakingRewardsWithPlatformTokenImusdPolygon2__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon2__factory"
import { StakingRewardsWithPlatformTokenImusdPolygon2 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon2"




import {
    // BoostedSavingsVaultLegacyBTC,
    // BoostedSavingsVaultLegacyBTC__factory,
    // BoostedSavingsVaultLegacyUSD,
    // BoostedSavingsVaultLegacyUSD__factory,
    BoostedVault__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    IERC20__factory,
    Nexus__factory,
    SavingsContract,
    SavingsContract__factory,
    Unwrapper,
    // UnwrapperProxy__factory,
    Unwrapper__factory,
} from "types/generated"
import { Chain, DEAD_ADDRESS, increaseTime, ONE_WEEK, simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress , resolveAddress} from "tasks/utils/networkAddressFactory"


const chain = Chain.mainnet
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = getChainAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)

const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const imusdHolderAddress = "0xdA1fD36cfC50ED03ca4dd388858A78C904379fb3"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f"
const alusdAddress = "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9"
const musdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5"
const imusdAddress = "0x30647a72Dc82d7Fbb1123EA74716aB8A317Eac19"
const imusdVaultAddress = "0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B"
const alusdFeederPool = "0x4eaa01974B6594C0Ee62fFd7FEE56CF11E6af936"
const mtaAddress = "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2"
const mbtcAddress = "0x945facb997494cc2570096c74b5f66a3507330a1"
// const mbtcAddress = resolveAddress("mBTC", Chain.mainnet)
// console.log("mbtcAddress", mbtcAddress) 
const imbtcAddress = "0x17d8cbb6bce8cee970a4027d1198f6700a7a6c24"
const imbtcVaultAddress = "0xF38522f63f40f9Dd81aBAfD2B8EFc2EC958a3016"
const wbtcAddress = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"
const hbtcAddress = "0x0316EB71485b0Ab14103307bf65a021042c6d380"
const hbtcFeederPool = "0x48c59199da51b7e30ea200a74ea07974e62c4ba7"
const boostDirectorAddress = "0xba05fd2f20ae15b0d3f20ddc6870feca6acd3592"
const imbtcHolderAddress = "0xd2270cdc82675a3c0ad8cbee1e9c26c85b46456c"
const vmbtcHolderAddress = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
const vhbtcmbtcHolderAddress = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
const vmusdHolderAddress = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"

context("Unwrapper", () => {
    let deployer: Signer
    let musdHolder: Signer
    let unwrapper: Unwrapper
    let governor: Signer
    let delayedProxyAdmin: DelayedProxyAdmin

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                         //  (Nov-01-2021 06:33:00 AM +UTC)
                        blockNumber: 13529662,
                    },
                },
            ],
        })
        // await network.provider.send("debug_traceTransaction", [
        //     musdHolderAddress
        //   ]);
        //   await network.provider.send("debug_traceTransaction", [
        //     imusdHolderAddress,
        //   ]);
        //    await network.provider.send("debug_traceTransaction", [
        //      musdAddress
        //   ]);     
        //   await network.provider.send("debug_traceTransaction", [
        //     deployerAddress
        //  ]);               
                         

        //   await network.provider.send("hardhat_setBalance", [
        //     "0x0d2026b3EE6eC71FC6746ADb6311F6d3Ba1C000B",
        //     "0x1000",
        //   ]);

        musdHolder = await impersonate(musdHolderAddress)
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
    })
    it("Test connectivity", async () => {
        const startEther = await deployer.getBalance()
        const address = await deployer.getTransactionCount()
        console.log(`Deployer ${address} has ${startEther} Ether`)
    })

    it("Deploys the unwrapper proxy contract ", async () => {
        unwrapper = await deployContract<Unwrapper>(new Unwrapper__factory(deployer), "Unwrapper", [nexusAddress])
        expect(unwrapper.address).to.length(42)

        // approve tokens for router
        const routers = [alusdFeederPool, hbtcFeederPool]
        const tokens = [musdAddress, mbtcAddress]

        await unwrapper.connect(governor).approve(routers, tokens)
    })

    it("Can call getIsBassetOut & it functions correctly", async () => {
        const isCredit = true
        expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, !isCredit, daiAddress)).to.eq(true)
        expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, !isCredit, musdAddress)).to.eq(false)
        expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, !isCredit, alusdAddress)).to.eq(false)
        expect(await unwrapper.callStatic.getIsBassetOut(mbtcAddress, !isCredit, wbtcAddress)).to.eq(true)
        expect(await unwrapper.callStatic.getIsBassetOut(mbtcAddress, !isCredit, mbtcAddress)).to.eq(false)
        expect(await unwrapper.callStatic.getIsBassetOut(mbtcAddress, !isCredit, hbtcAddress)).to.eq(false)
    })

    const validateAssetRedemption = async (
        config: {
            router: string
            input: string
            output: string
            amount: BigNumber
            isCredit: boolean
        },
        signer: Signer,
    ) => {
        // Get estimated output via getUnwrapOutput
        const signerAddress = await signer.getAddress()
        const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.isCredit, config.output)

        // await network.provider.send("debug_traceTransaction", [
        //     deployerAddress
        //  ]);    

        const amountOut = await unwrapper.getUnwrapOutput(
            isBassetOut,
            config.router,
            config.input,
            config.isCredit,
            config.output,
            config.amount,
        )
        expect(amountOut.toString().length).to.be.gte(18)
        const minAmountOut = amountOut.mul(98).div(1e2)

        const newConfig = {
            ...config,
            minAmountOut,
            beneficiary: signerAddress,
        }

        // check balance before
        const tokenOut = IERC20__factory.connect(config.output, signer)
        const tokenBalanceBefore = await tokenOut.balanceOf(signerAddress)

        // approve musd for unwrapping
        const musd = IERC20__factory.connect(musdAddress, signer)
        await musd.approve(unwrapper.address, config.amount)

        // redeem to basset via unwrapAndSend
        await unwrapper.connect(signer).unwrapAndSend(
            isBassetOut,
            newConfig.router,
            newConfig.input,
            newConfig.output,
            newConfig.amount,
            newConfig.minAmountOut,
            newConfig.beneficiary,
        )
        // await network.provider.send("debug_traceTransaction", [
        //     tx.hash
        //   ]);

        // check balance after
        const tokenBalanceAfter = await tokenOut.balanceOf(signerAddress)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
    }

    it("Receives the correct output from getUnwrapOutput", async () => {
        const config = {
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }
        const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.isCredit, config.output)
        const output = await unwrapper.getUnwrapOutput(
            isBassetOut,
            config.router,
            config.input,
            config.isCredit,
            config.output,
            config.amount,
        )
        expect(output.toString()).to.be.length(19)
    })

    it("imUSD redeem to bAsset via unwrapAndSend", async () => {
        const config = {
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }
        await validateAssetRedemption(config, musdHolder)
    })

    it("imUSD redeem to fAsset via unwrapAndSend", async () => {
        const config = {
            router: alusdFeederPool,
            input: musdAddress,
            output: alusdAddress,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }
        await validateAssetRedemption(config, musdHolder)
    })

    it("Upgrades the imUSD contract", async () => {
        const musdSaveImpl = await deployContract<SavingsContract>(
            new SavingsContract__factory(deployer),
            "mStable: mUSD Savings Contract",
            [nexusAddress, musdAddress, unwrapper.address],
        )

        expect(await delayedProxyAdmin.callStatic.nexus(), "nexus not match").to.eq(nexusAddress)
        expect(await Nexus__factory.connect(nexusAddress, governor).callStatic.governor(), "governor not match").to.eq(governorAddress)

        await delayedProxyAdmin.proposeUpgrade(imusdAddress, musdSaveImpl.address, [])
        await increaseTime(ONE_WEEK.add(60))

        // check request is correct
        const request = await delayedProxyAdmin.requests(imusdAddress)
        expect(request.implementation).eq(musdSaveImpl.address)

        // accept upgrade
        await delayedProxyAdmin.acceptUpgradeRequest(imusdAddress)

        // verify unwrapper address set
        const saveContractProxy = SavingsContract__factory.connect(imusdAddress, governor)
        const unwrapperAddress = await saveContractProxy.unwrapper()
        expect(unwrapperAddress).to.eq(unwrapper.address)
    })

    it("imUSD contract works after upgraded", async () => {
        const imusdHolder = await impersonate(imusdHolderAddress)

        const config = {
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }

        // Get estimated output via getUnwrapOutput
        const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.isCredit, config.output)
        const amountOut = await unwrapper.getUnwrapOutput(
            isBassetOut,
            config.router,
            config.input,
            config.isCredit,
            config.output,
            config.amount,
        )
        expect(amountOut.toString().length).to.be.gte(18)
        const minAmountOut = amountOut.mul(98).div(1e2)

        // dai balance before
        const daiBalanceBefore = await IERC20__factory.connect(daiAddress, imusdHolder).balanceOf(imusdHolderAddress)

        const saveContractProxy = SavingsContract__factory.connect(imusdAddress, imusdHolder)
        await saveContractProxy.redeemAndUnwrap(
            config.amount,
            config.isCredit,
            minAmountOut,
            config.output,
            imusdHolderAddress,
            config.router,
            isBassetOut,
        )
        const daiBalanceAfter = await IERC20__factory.connect(daiAddress, imusdHolder).balanceOf(imusdHolderAddress)
        const tokenBalanceDifference = daiBalanceAfter.sub(daiBalanceBefore)
        expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
        expect(daiBalanceAfter, "Token balance has increased").to.be.gt(daiBalanceBefore.add(minAmountOut))
    })

    it("Upgrades the imUSD Vault", async () => {
        // contracts/legacy/imusd-vault-mainnet-1.sol
        const saveVaultImpl = await deployContract<BoostedSavingsVaultImusdMainnet2>(
            new BoostedSavingsVaultImusdMainnet2__factory(deployer),
            "mStable: mUSD Savings Vault",
            [],
        )

        await delayedProxyAdmin.proposeUpgrade(imusdVaultAddress, saveVaultImpl.address, "0x")
        await increaseTime(ONE_WEEK.add(60))

        // check request is correct
        const request = await delayedProxyAdmin.requests(imusdVaultAddress)
        expect(request.implementation).eq(saveVaultImpl.address)

        // accept upgrade
        await delayedProxyAdmin.acceptUpgradeRequest(imusdVaultAddress)

        expect(await delayedProxyAdmin.getProxyImplementation(imusdVaultAddress)).eq(saveVaultImpl.address)
    })

    const withdrawAndUnwrap = async (holderAddress: string, router: string, input: "musd" | "mbtc", outputAddress: string) => {
        try {
            

        const isCredit = true
        const holder = await impersonate(holderAddress)
        const vaultAddress = input === "musd" ? imusdVaultAddress : imbtcVaultAddress
        const inputAddress = input === "musd" ? musdAddress : mbtcAddress
        const isBassetOut = await unwrapper.callStatic.getIsBassetOut(inputAddress, isCredit, outputAddress)

        const config = {
            router,
            input: inputAddress,
            output: outputAddress,
            amount: simpleToExactAmount(input === "musd" ? 100 : 10, 18),
            isCredit,
        }

        // Get estimated output via getUnwrapOutput
        const amountOut = await unwrapper.getUnwrapOutput(
            isBassetOut,
            config.router,
            config.input,
            config.isCredit,
            config.output,
            config.amount,
        )
        expect(amountOut.toString().length).to.be.gte(input === "musd" ? 18 : 9)
        const minAmountOut = amountOut.mul(98).div(1e2)

        const outContract = IERC20__factory.connect(config.output, holder)
        const tokenBalanceBefore = await outContract.balanceOf(holderAddress)

        // withdraw and unwrap
        const saveVault = BoostedVault__factory.connect(vaultAddress, holder)
        await saveVault.withdrawAndUnwrap(config.amount, minAmountOut, config.output, holderAddress, config.router, isBassetOut)

        const tokenBalanceAfter = await outContract.balanceOf(holderAddress)
        const tokenBalanceDifference = tokenBalanceAfter.sub(tokenBalanceBefore)
        expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
    } catch (error) {
        console.error(error)
        throw new Error(error);
        
            
    }

    }

    it("imUSD Vault redeem to bAsset", async () => {
        await withdrawAndUnwrap(vmusdHolderAddress, musdAddress, "musd", daiAddress)
    })

    it("imUSD Vault redeem to fAsset", async () => {
        await withdrawAndUnwrap(vmusdHolderAddress, alusdFeederPool, "musd", alusdAddress)
    })

    it("Upgrades the imBTC contract", async () => {
        const mbtcSaveImpl = await deployContract<SavingsContract>(
            new SavingsContract__factory(deployer),
            "mStable: mBTC Savings Contract",
            [nexusAddress, mbtcAddress, unwrapper.address],
        )

        expect(await delayedProxyAdmin.callStatic.nexus(), "nexus not match").to.eq(nexusAddress)
        expect(await Nexus__factory.connect(nexusAddress, governor).callStatic.governor(), "governor not match").to.eq(governorAddress)

        await delayedProxyAdmin.proposeUpgrade(imbtcAddress, mbtcSaveImpl.address, [])
        await increaseTime(ONE_WEEK.add(60))

        // check request is correct
        const request = await delayedProxyAdmin.requests(imbtcAddress)
        expect(request.implementation).eq(mbtcSaveImpl.address)

        // accept upgrade
        await delayedProxyAdmin.acceptUpgradeRequest(imbtcAddress)

        // verify unwrapper address set
        const saveContractProxy = SavingsContract__factory.connect(imbtcAddress, governor)
        const unwrapperAddress = await saveContractProxy.unwrapper()
        expect(unwrapperAddress).to.eq(unwrapper.address)
    })

    it("imBTC contract works after upgraded", async () => {        
        const imbtcHolder = await impersonate(imbtcHolderAddress)

        const config = {
            router: mbtcAddress,
            input: mbtcAddress,
            output: wbtcAddress,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }

        // Get estimated output via getUnwrapOutput
        const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.isCredit, config.output)
        const amountOut = await unwrapper.getUnwrapOutput(
            isBassetOut,
            config.router,
            config.input,
            config.isCredit,
            config.output,
            config.amount,
        )
        expect(amountOut.toString().length).to.be.gte(8)
        const minAmountOut = amountOut.mul(98).div(1e2)

        // wbtc balance before
        const wbtcBalanceBefore = await IERC20__factory.connect(wbtcAddress, imbtcHolder).balanceOf(imbtcHolderAddress)
        const saveContractProxy = SavingsContract__factory.connect(imbtcAddress, imbtcHolder)

        await saveContractProxy.redeemAndUnwrap(
            config.amount,
            config.isCredit,
            minAmountOut,
            config.output,
            imbtcHolderAddress,
            config.router,
            isBassetOut,
        )
        const wbtcBalanceAfter = await IERC20__factory.connect(wbtcAddress, imbtcHolder).balanceOf(imbtcHolderAddress)
        const tokenBalanceDifference = wbtcBalanceAfter.sub(wbtcBalanceBefore)
        expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
        expect(wbtcBalanceAfter, "Token balance has increased").to.be.gt(wbtcBalanceBefore.add(minAmountOut))
    })

    it("Upgrades the imBTC Vault", async () => {
        const boostDirector = boostDirectorAddress
        const priceCoeff = simpleToExactAmount(4800, 18)
        const boostCoeff = 9

        const saveVaultImpl = await deployContract<BoostedSavingsVaultImbtcMainnet2>(
            new BoostedSavingsVaultImbtcMainnet2__factory(deployer),
            "mStable: mBTC Savings Vault",
            [nexusAddress, imbtcAddress, boostDirector, priceCoeff, boostCoeff, mtaAddress],
        )

        await delayedProxyAdmin.proposeUpgrade(imbtcVaultAddress, saveVaultImpl.address, "0x")
        await increaseTime(ONE_WEEK.add(60))

        // check request is correct
        const request = await delayedProxyAdmin.requests(imbtcVaultAddress)
        expect(request.implementation).eq(saveVaultImpl.address)

        // accept upgrade
        await delayedProxyAdmin.acceptUpgradeRequest(imbtcVaultAddress)

        expect(await delayedProxyAdmin.getProxyImplementation(imbtcVaultAddress)).eq(saveVaultImpl.address)
    })

    it("imBTC Vault redeem to bAsset", async () => {
        await withdrawAndUnwrap(vmbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress)
    })

    it("imBTC Vault redeem to fAsset", async () => {
        await withdrawAndUnwrap(vhbtcmbtcHolderAddress, hbtcFeederPool, "mbtc", hbtcAddress)
    })

    it("Emits referrer successfully", async () => {
        const saveContractProxy = SavingsContract__factory.connect(imusdAddress, musdHolder)
        const musdContractProxy = ERC20__factory.connect(musdAddress, musdHolder)
        await musdContractProxy.approve(imusdAddress, simpleToExactAmount(100, 18))
        const tx = await saveContractProxy["depositSavings(uint256,address,address)"](
            simpleToExactAmount(1, 18),
            musdHolderAddress,
            DEAD_ADDRESS,
        )
        await expect(tx)
            .to.emit(saveContractProxy, "Referral")
            .withArgs(DEAD_ADDRESS, "0x8474DdbE98F5aA3179B3B3F5942D724aFcdec9f6", simpleToExactAmount(1, 18))
    })
})
