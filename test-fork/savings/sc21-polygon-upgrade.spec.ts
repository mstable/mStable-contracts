import { impersonate } from "@utils/fork"
import { Signer, ContractFactory } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
// Polygon imUSD Contract
import { SavingsContractImusdPolygon21__factory } from "types/generated/factories/SavingsContractImusdPolygon21__factory"
import { SavingsContractImusdPolygon21 } from "types/generated/SavingsContractImusdPolygon21"
// Polygon imUSD Vault
import { StakingRewardsWithPlatformTokenImusdPolygon2__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon2__factory"
import { StakingRewardsWithPlatformTokenImusdPolygon2 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon2"
import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    IERC20__factory,
    Unwrapper,
    Unwrapper__factory,
    AssetProxy__factory,
} from "types/generated"

import { assertBNClosePercent, Chain, DEAD_ADDRESS, simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress, resolveAddress } from "tasks/utils/networkAddressFactory"
import { upgradeContract } from "@utils/deploy"

const chain = Chain.polygon
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const multiSigAddress = "0x4aA2Dd5D5387E4b8dcf9b6Bfa4D9236038c3AD43" // 4/8 Multisig
const governorAddress = resolveAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)
const deployerAddress = getChainAddress("OperationsSigner", chain)
const imusdHolderAddress = "0x9d8B7A637859668A903797D9f02DE2Aa05e5b0a0"
const musdHolderAddress = "0xb14fFDB81E804D2792B6043B90aE5Ac973EcD53D"
const vmusdHolderAddress = "0x9d8B7A637859668A903797D9f02DE2Aa05e5b0a0"

const daiAddress = resolveAddress("DAI", chain)
const fraxAddress = resolveAddress("FRAX", chain)
const musdAddress = resolveAddress("mUSD", chain)
const imusdAddress = resolveAddress("mUSD", chain, "savings")
const imusdVaultAddress = resolveAddress("mUSD", chain, "vault")
const fraxFeederPool = resolveAddress("FRAX", chain, "feederPool")
const mtaAddress = resolveAddress("MTA", chain)
const wmaticAddress = resolveAddress("WMATIC", chain)

// DEPLOYMENT PIPELINE
//  1. Deploy Unwrapper
//   1.1. Set the Unwrapper address as constant in imUSD Vault via initialize
//  2. Upgrade and check storage
//   2.1. Vaults
//   2.2. SavingsContracts
//  3. Do some unwrapping
//   3.1. Directly to unwrapper
//   3.2. Via SavingsContracts
//   3.3. Via SavingsVaults
context("Unwrapper and Vault upgrades", () => {
    let deployer: Signer
    let musdHolder: Signer
    let unwrapper: Unwrapper
    let governor: Signer
    let multiSig: Signer
    let delayedProxyAdmin: DelayedProxyAdmin

    const redeemAndUnwrap = async (
        holderAddress: string,
        router: string,
        input: "musd" | "mbtc",
        outputAddress: string,
        isCredit = false,
    ) => {
        if (input === "mbtc") throw new Error("mbtc not supported")

        const holder = await impersonate(holderAddress)
        const saveAddress = imusdAddress
        let inputAddress = musdAddress

        if (input === "musd" && isCredit) {
            inputAddress = imusdAddress
        } else if (input === "musd" && !isCredit) {
            inputAddress = musdAddress
        }

        const amount = input === "musd" ? simpleToExactAmount(1, 14) : simpleToExactAmount(1, 14)

        const config = {
            router,
            input: inputAddress,
            output: outputAddress,
            amount: isCredit ? amount : amount.mul(10),
            isCredit,
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
        expect(amountOut.toString().length).to.be.gte(input === "musd" ? 14 : 4)
        const minAmountOut = amountOut.mul(98).div(1e2)
        const outContract = IERC20__factory.connect(config.output, holder)
        const tokenBalanceBefore = await outContract.balanceOf(holderAddress)
        const saveContract = SavingsContractImusdPolygon21__factory.connect(saveAddress, holder)

        const holderVaultBalanceBefore = await saveContract.balanceOf(holderAddress)

        await saveContract.redeemAndUnwrap(
            config.amount,
            config.isCredit,
            minAmountOut,
            config.output,
            holderAddress,
            config.router,
            isBassetOut,
        )

        const tokenBalanceAfter = await outContract.balanceOf(holderAddress)
        const holderVaultBalanceAfter = await saveContract.balanceOf(holderAddress)

        const tokenBalanceDifference = tokenBalanceAfter.sub(tokenBalanceBefore)
        assertBNClosePercent(tokenBalanceDifference, amountOut, 0.001)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
        expect(holderVaultBalanceAfter, "Vault balance has decreased").to.be.lt(holderVaultBalanceBefore)
    }
    /**
     * imUSD Vault on polygon was deployed with the wrong proxy admin, this fix the issue setting the DelayedProxyAdmin as it's proxy admin
     * It changes from multiSig to delayedProxyAdmin.address
     */
    async function fixImusdVaultProxyAdmin() {
        const imusdVaultAssetProxy = AssetProxy__factory.connect(imusdVaultAddress, multiSig)
        await imusdVaultAssetProxy.changeAdmin(delayedProxyAdmin.address)
    }
    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 24186168,
                    },
                },
            ],
        })

        musdHolder = await impersonate(musdHolderAddress)
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        multiSig = await impersonate(multiSigAddress)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
    })
    it("Test connectivity", async () => {
        const startEther = await deployer.getBalance()
        const address = await deployer.getTransactionCount()
        console.log(`Deployer ${address} has ${startEther} Ether`)
    })

    context("Stage 1", () => {
        it("Deploys the unwrapper proxy contract ", async () => {
            unwrapper = await deployContract<Unwrapper>(new Unwrapper__factory(deployer), "Unwrapper", [nexusAddress])
            expect(unwrapper.address).to.length(42)
            // approve tokens for router
            const routers = [fraxFeederPool]
            const tokens = [musdAddress]
            await unwrapper.connect(governor).approve(routers, tokens)
        })
    })

    context("Stage 2", () => {
        describe("2.1 Upgrading vaults", () => {
            it("Upgrades the imUSD Vault", async () => {
                await fixImusdVaultProxyAdmin()

                const constructorArguments = [
                    nexusAddress, // 0x3c6fbb8cbfcb75ecec5128e9f73307f2cb33f2f6 deployed
                    imusdAddress, // imUSD
                    mtaAddress, // MTA bridged to Polygon
                    wmaticAddress, // Wrapped Matic on Polygon
                ]

                const saveVaultImpl = await deployContract<StakingRewardsWithPlatformTokenImusdPolygon2>(
                    new StakingRewardsWithPlatformTokenImusdPolygon2__factory(deployer),
                    "mStable: mUSD Savings Vault",
                    constructorArguments,
                )
                await upgradeContract<StakingRewardsWithPlatformTokenImusdPolygon2>(
                    StakingRewardsWithPlatformTokenImusdPolygon2__factory as unknown as ContractFactory,
                    saveVaultImpl,
                    imusdVaultAddress,
                    governor,
                    delayedProxyAdmin,
                )
                expect(await delayedProxyAdmin.getProxyImplementation(imusdVaultAddress)).eq(saveVaultImpl.address)
            })
        })
        describe("2.2 Upgrading savings contracts", () => {
            it("Upgrades the imUSD contract", async () => {
                const constructorArguments = [nexusAddress, musdAddress, unwrapper.address]
                const musdSaveImpl = await deployContract<SavingsContractImusdPolygon21>(
                    new SavingsContractImusdPolygon21__factory(deployer),
                    "mStable: mUSD Savings Contract",
                    constructorArguments,
                )
                const saveContractProxy = await upgradeContract<SavingsContractImusdPolygon21>(
                    SavingsContractImusdPolygon21__factory as unknown as ContractFactory,
                    musdSaveImpl,
                    imusdAddress,
                    governor,
                    delayedProxyAdmin,
                )

                const unwrapperAddress = await saveContractProxy.unwrapper()
                expect(unwrapperAddress).to.eq(unwrapper.address)
                expect(await delayedProxyAdmin.getProxyImplementation(imusdAddress)).eq(musdSaveImpl.address)
                expect(musdAddress).eq(await musdSaveImpl.underlying())
            })

            it("imUSD contract works after upgraded", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress)
            })
        })
    })

    context("Stage 3", () => {
        describe("3.1 Directly", () => {
            it("Can call getIsBassetOut & it functions correctly", async () => {
                const isCredit = true
                expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, !isCredit, daiAddress)).to.eq(true)
                expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, !isCredit, musdAddress)).to.eq(false)
                expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, !isCredit, fraxAddress)).to.eq(false)
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
                const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, false, config.output)

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
                const tokenInput = IERC20__factory.connect(config.input, signer)
                await tokenInput.approve(unwrapper.address, config.amount)

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
                expect(output.toString()).to.be.length(18)
            })

            it("mUSD redeem to bAsset via unwrapAndSend", async () => {
                const config = {
                    router: musdAddress,
                    input: musdAddress,
                    output: daiAddress,
                    amount: simpleToExactAmount(1, 18),
                    isCredit: false,
                }

                await validateAssetRedemption(config, musdHolder)
            })

            it("mUSD redeem to fAsset via unwrapAndSend", async () => {
                const config = {
                    router: fraxFeederPool,
                    input: musdAddress,
                    output: fraxAddress,
                    amount: simpleToExactAmount(1, 18),
                    isCredit: false,
                }
                await validateAssetRedemption(config, musdHolder)
            })
        })

        describe("3.2 Via SavingsContracts", () => {
            it("mUSD contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress)
            })

            it("mUSD contract redeem to fAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, fraxFeederPool, "musd", fraxAddress)
            })
            // credits
            it("imUSD contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress, true)
            })

            it("imUSD contract redeem to fAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, fraxFeederPool, "musd", fraxAddress, true)
            })
        })

        describe("3.3 Via Vaults", () => {
            const withdrawAndUnwrap = async (holderAddress: string, router: string, input: "musd" | "mbtc", outputAddress: string) => {
                if (input === "mbtc") throw new Error("mBTC not supported")

                const isCredit = true
                const holder = await impersonate(holderAddress)
                const vaultAddress = imusdVaultAddress
                const inputAddress = imusdAddress
                const isBassetOut = await unwrapper.callStatic.getIsBassetOut(inputAddress, isCredit, outputAddress)
                const config = {
                    router,
                    input: inputAddress,
                    output: outputAddress,
                    amount: simpleToExactAmount(1, 18),
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
                const saveVault = StakingRewardsWithPlatformTokenImusdPolygon2__factory.connect(vaultAddress, holder)
                const holderVaultBalanceBefore = await saveVault.balanceOf(holderAddress)

                await saveVault.withdrawAndUnwrap(config.amount, minAmountOut, config.output, holderAddress, config.router, isBassetOut)
                const holderVaultBalanceAfter = await saveVault.balanceOf(holderAddress)

                const tokenBalanceAfter = await outContract.balanceOf(holderAddress)
                const tokenBalanceDifference = tokenBalanceAfter.sub(tokenBalanceBefore)
                assertBNClosePercent(tokenBalanceDifference, amountOut, 0.001)
                expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
                expect(holderVaultBalanceAfter, "Vault balance has decreased").to.be.lt(holderVaultBalanceBefore)
            }

            it("imUSD Vault redeem to bAsset", async () => {
                await withdrawAndUnwrap(vmusdHolderAddress, musdAddress, "musd", daiAddress)
            })

            it("imUSD Vault redeem to fAsset", async () => {
                await withdrawAndUnwrap(vmusdHolderAddress, fraxFeederPool, "musd", fraxAddress)
            })

            it("Emits referrer successfully", async () => {
                const saveContractProxy = SavingsContractImusdPolygon21__factory.connect(imusdAddress, musdHolder)
                const musdContractProxy = ERC20__factory.connect(musdAddress, musdHolder)
                await musdContractProxy.approve(imusdAddress, simpleToExactAmount(100, 18))
                const tx = await saveContractProxy["depositSavings(uint256,address,address)"](
                    simpleToExactAmount(1, 18),
                    musdHolderAddress,
                    DEAD_ADDRESS,
                )
                await expect(tx)
                    .to.emit(saveContractProxy, "Referral")
                    .withArgs(DEAD_ADDRESS, musdHolderAddress, simpleToExactAmount(1, 18))
            })
        })
    })
})
