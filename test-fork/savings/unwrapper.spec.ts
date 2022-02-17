import { impersonate } from "@utils/fork"
import { Signer, ContractFactory } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import {
    BoostedVault,
    BoostedVault__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    IERC20__factory,
    // Mainnet imUSD Contract
    SavingsContract,
    SavingsContract__factory,
    Unwrapper,
    Unwrapper__factory,
} from "types/generated"
import { Chain, DEAD_ADDRESS, simpleToExactAmount, assertBNClosePercent, DAI, WBTC, MTA, alUSD, mUSD, mBTC, HBTC, USDT } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress } from "tasks/utils/networkAddressFactory"
import { upgradeContract } from "@utils/deploy"

const chain = Chain.mainnet
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = getChainAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)
const boostDirectorAddress = getChainAddress("BoostDirector", chain)
const deployerAddress = getChainAddress("OperationsSigner", chain)

const imusdHolderAddress = "0xdA1fD36cfC50ED03ca4dd388858A78C904379fb3"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
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
        const routers = [alUSD.feederPool, HBTC.feederPool]
        const tokens = [mUSD.address, mBTC.address]

        await unwrapper.connect(governor).approve(routers, tokens)
    })

    describe("Successfully call getIsBassetOut for", () => {
        const isCredit = true
        it("mAssets", async () => {
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.address, !isCredit, DAI.address)).to.eq(true)
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.address, !isCredit, USDT.address)).to.eq(true)
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.address, !isCredit, mUSD.address)).to.eq(false)
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.address, !isCredit, alUSD.address)).to.eq(false)
            expect(await unwrapper.callStatic.getIsBassetOut(mBTC.address, !isCredit, WBTC.address)).to.eq(true)
            expect(await unwrapper.callStatic.getIsBassetOut(mBTC.address, !isCredit, mBTC.address)).to.eq(false)
            expect(await unwrapper.callStatic.getIsBassetOut(mBTC.address, !isCredit, HBTC.address)).to.eq(false)
        })
        it("interest-bearing assets", async () => {
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.savings, isCredit, DAI.address)).to.eq(true)
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.savings, isCredit, USDT.address)).to.eq(true)
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.savings, isCredit, mUSD.address)).to.eq(false)
            expect(await unwrapper.callStatic.getIsBassetOut(mUSD.savings, isCredit, alUSD.address)).to.eq(false)
            expect(await unwrapper.callStatic.getIsBassetOut(mBTC.savings, isCredit, WBTC.address)).to.eq(true)
            expect(await unwrapper.callStatic.getIsBassetOut(mBTC.savings, isCredit, mBTC.address)).to.eq(false)
            expect(await unwrapper.callStatic.getIsBassetOut(mBTC.savings, isCredit, HBTC.address)).to.eq(false)
        })
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
        const musd = IERC20__factory.connect(mUSD.address, signer)
        await musd.approve(unwrapper.address, config.amount)

        // Statically call unwrapAndSend to get the returned quantity of output tokens
        const outputQuantity = await unwrapper
            .connect(signer)
            .callStatic.unwrapAndSend(
                isBassetOut,
                newConfig.router,
                newConfig.input,
                newConfig.output,
                newConfig.amount,
                newConfig.minAmountOut,
                newConfig.beneficiary,
            )
        // redeem to basset via unwrapAndSend
        await unwrapper
            .connect(signer)
            .unwrapAndSend(
                isBassetOut,
                newConfig.router,
                newConfig.input,
                newConfig.output,
                newConfig.amount,
                newConfig.minAmountOut,
                newConfig.beneficiary,
            )
        // check balance after
        const tokenBalanceAfter = await tokenOut.balanceOf(signerAddress)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
        expect(outputQuantity, "Token output quantity").to.eq(tokenBalanceAfter.sub(tokenBalanceBefore))
    }

    it("Receives the correct output from getUnwrapOutput", async () => {
        const config = {
            router: mUSD.address,
            input: mUSD.address,
            output: DAI.address,
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
            router: mUSD.address,
            input: mUSD.address,
            output: DAI.address,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }
        await validateAssetRedemption(config, musdHolder)
    })

    it("imUSD redeem to fAsset via unwrapAndSend", async () => {
        const config = {
            router: alUSD.feederPool,
            input: mUSD.address,
            output: alUSD.address,
            amount: simpleToExactAmount(1, 18),
            isCredit: false,
        }
        await validateAssetRedemption(config, musdHolder)
    })

    it("Upgrades the imUSD contract", async () => {
        const constructorArguments = [nexusAddress, mUSD.address, unwrapper.address]
        const musdSaveImpl = await deployContract<SavingsContract>(
            new SavingsContract__factory(deployer),
            "mStable: mUSD Savings Contract",
            constructorArguments,
        )

        const saveContractProxy = await upgradeContract<SavingsContract>(
            SavingsContract__factory as unknown as ContractFactory,
            musdSaveImpl,
            mUSD.savings,
            governor,
            delayedProxyAdmin,
        )
        const unwrapperAddress = await saveContractProxy.unwrapper()
        expect(unwrapperAddress).to.eq(unwrapper.address)
        expect(await delayedProxyAdmin.getProxyImplementation(mUSD.savings)).eq(musdSaveImpl.address)
    })

    it("imUSD contract works after upgraded", async () => {
        const imusdHolder = await impersonate(imusdHolderAddress)

        const config = {
            router: mUSD.address,
            input: mUSD.address,
            output: DAI.address,
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
        const daiBalanceBefore = await IERC20__factory.connect(DAI.address, imusdHolder).balanceOf(imusdHolderAddress)

        const saveContractProxy = SavingsContract__factory.connect(mUSD.savings, imusdHolder)
        await saveContractProxy.redeemAndUnwrap(
            config.amount,
            config.isCredit,
            minAmountOut,
            config.output,
            imusdHolderAddress,
            config.router,
            isBassetOut,
        )
        const daiBalanceAfter = await IERC20__factory.connect(DAI.address, imusdHolder).balanceOf(imusdHolderAddress)
        const tokenBalanceDifference = daiBalanceAfter.sub(daiBalanceBefore)
        expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
        expect(daiBalanceAfter, "Token balance has increased").to.be.gt(daiBalanceBefore.add(minAmountOut))
    })

    it("Upgrades the imUSD Vault", async () => {
        const priceCoeff = simpleToExactAmount(1, 18)
        const boostCoeff = 9
        const constructorArguments = [nexusAddress, mUSD.address, boostDirectorAddress, priceCoeff, boostCoeff, MTA.address]
        const saveVaultImpl = await deployContract<BoostedVault>(
            new BoostedVault__factory(deployer),
            "mStable: mUSD Savings Vault",
            constructorArguments,
        )
        await upgradeContract<BoostedVault>(
            BoostedVault__factory as unknown as ContractFactory,
            saveVaultImpl,
            mUSD.vault,
            governor,
            delayedProxyAdmin,
        )
        expect(await delayedProxyAdmin.getProxyImplementation(mUSD.vault)).eq(saveVaultImpl.address)
    })
    const withdrawAndUnwrap = async (holderAddress: string, router: string, input: "musd" | "mbtc", outputAddress: string) => {
        const isCredit = true
        const holder = await impersonate(holderAddress)
        const vaultAddress = input === "musd" ? mUSD.vault : mBTC.vault
        const inputAddress = input === "musd" ? mUSD.savings : mBTC.savings
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
        assertBNClosePercent(tokenBalanceDifference, amountOut, 0.0001)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
    }

    it.skip("imUSD Vault redeem to bAsset", async () => {
        await withdrawAndUnwrap(vmusdHolderAddress, mUSD.address, "musd", DAI.address)
    })

    it.skip("imUSD Vault redeem to fAsset", async () => {
        await withdrawAndUnwrap(vmusdHolderAddress, alUSD.feederPool, "musd", alUSD.address)
    })

    it("Upgrades the imBTC contract", async () => {
        const constructorArguments = [nexusAddress, mBTC.address, unwrapper.address]
        const saveImpl = await deployContract<SavingsContract>(
            new SavingsContract__factory(deployer),
            "mStable: mBTC Savings",
            constructorArguments,
        )

        await upgradeContract<SavingsContract>(
            SavingsContract__factory as unknown as ContractFactory,
            saveImpl,
            mBTC.savings,
            governor,
            delayedProxyAdmin,
        )
        expect(await delayedProxyAdmin.getProxyImplementation(mBTC.savings)).eq(saveImpl.address)
    })
    it("imBTC contract works after upgraded", async () => {
        const imbtcHolder = await impersonate(imbtcHolderAddress)

        const config = {
            router: mBTC.address,
            input: mBTC.address,
            output: WBTC.address,
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
        const wbtcBalanceBefore = await IERC20__factory.connect(WBTC.address, imbtcHolder).balanceOf(imbtcHolderAddress)
        const saveContractProxy = SavingsContract__factory.connect(mBTC.savings, imbtcHolder)

        await saveContractProxy.redeemAndUnwrap(
            config.amount,
            config.isCredit,
            minAmountOut,
            config.output,
            imbtcHolderAddress,
            config.router,
            isBassetOut,
        )
        const wbtcBalanceAfter = await IERC20__factory.connect(WBTC.address, imbtcHolder).balanceOf(imbtcHolderAddress)
        const tokenBalanceDifference = wbtcBalanceAfter.sub(wbtcBalanceBefore)
        expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
        expect(wbtcBalanceAfter, "Token balance has increased").to.be.gt(wbtcBalanceBefore.add(minAmountOut))
    })

    it("Upgrades the imBTC Vault", async () => {
        const boostDirector = boostDirectorAddress
        const priceCoeff = simpleToExactAmount(4800, 18)
        const boostCoeff = 9

        const saveVaultImpl = await deployContract<BoostedVault>(new BoostedVault__factory(deployer), "mStable: mBTC Savings Vault", [
            nexusAddress,
            mBTC.savings,
            boostDirector,
            priceCoeff,
            boostCoeff,
            MTA.address,
        ])
        await upgradeContract<BoostedVault>(
            BoostedVault__factory as unknown as ContractFactory,
            saveVaultImpl,
            mBTC.vault,
            governor,
            delayedProxyAdmin,
        )
        expect(await delayedProxyAdmin.getProxyImplementation(mBTC.vault)).eq(saveVaultImpl.address)
    })

    it("imBTC Vault redeem to bAsset", async () => {
        await withdrawAndUnwrap(vmbtcHolderAddress, mBTC.address, "mbtc", WBTC.address)
    })

    it("imBTC Vault redeem to fAsset", async () => {
        await withdrawAndUnwrap(vhbtcmbtcHolderAddress, HBTC.feederPool, "mbtc", HBTC.address)
    })

    it("Emits referrer successfully", async () => {
        const saveContractProxy = SavingsContract__factory.connect(mUSD.savings, musdHolder)
        const musdContractProxy = ERC20__factory.connect(mUSD.address, musdHolder)
        await musdContractProxy.approve(mUSD.savings, simpleToExactAmount(100, 18))
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
