import { impersonate } from "@utils/fork"
import { Signer, ContractFactory } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"

// Mainnet imBTC Contract
import { SavingsContractImbtcMainnet21__factory } from "types/generated/factories/SavingsContractImbtcMainnet21__factory"
import { SavingsContractImbtcMainnet21 } from "types/generated/SavingsContractImbtcMainnet21"
// Mainnet imBTC Vault
import { BoostedSavingsVaultImbtcMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet2__factory"
import { BoostedSavingsVaultImbtcMainnet2 } from "types/generated/BoostedSavingsVaultImbtcMainnet2"

// Mainnet imUSD Contract
import { SavingsContractImusdMainnet21__factory } from "types/generated/factories/SavingsContractImusdMainnet21__factory"
import { SavingsContractImusdMainnet21 } from "types/generated/SavingsContractImusdMainnet21"
// Mainnet imUSD Vault
import { BoostedSavingsVaultImusdMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet2__factory"
import { BoostedSavingsVaultImusdMainnet2 } from "types/generated/BoostedSavingsVaultImusdMainnet2"

// Polygon imUSD Contract
// Polygon imUSD Vault

import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    IERC20__factory,
    Unwrapper,
    Unwrapper__factory,
} from "types/generated"

import { assertBNClosePercent, Chain, DEAD_ADDRESS, simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress, resolveAddress } from "tasks/utils/networkAddressFactory"
import { upgradeContract } from "@utils/deploy"

const chain = Chain.mainnet
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = getChainAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)
const boostDirector = getChainAddress("BoostDirector", chain)

const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const imusdHolderAddress = "0xdA1fD36cfC50ED03ca4dd388858A78C904379fb3"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
const imbtcHolderAddress = "0x720366c95d26389471c52f854d43292157c03efd"
const vmusdHolderAddress = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"
const vmbtcHolderAddress = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
const vhbtcmbtcHolderAddress = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
const daiAddress = resolveAddress("DAI", Chain.mainnet)
const alusdAddress = resolveAddress("alUSD", Chain.mainnet)
const musdAddress = resolveAddress("mUSD", Chain.mainnet)
const imusdAddress = resolveAddress("mUSD", Chain.mainnet, "savings")
const imusdVaultAddress = resolveAddress("mUSD", Chain.mainnet, "vault")
const alusdFeederPool = resolveAddress("alUSD", Chain.mainnet, "feederPool")
const mtaAddress = resolveAddress("MTA", Chain.mainnet)
const mbtcAddress = resolveAddress("mBTC", Chain.mainnet)
const imbtcAddress = resolveAddress("mBTC", Chain.mainnet, "savings")
const imbtcVaultAddress = resolveAddress("mBTC", Chain.mainnet, "vault")
const wbtcAddress = resolveAddress("WBTC", Chain.mainnet)
const hbtcAddress = resolveAddress("HBTC", Chain.mainnet)
const hbtcFeederPool = resolveAddress("HBTC", Chain.mainnet, "feederPool")

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
    let delayedProxyAdmin: DelayedProxyAdmin

    const redeemAndUnwrap = async (
        holderAddress: string,
        router: string,
        input: "musd" | "mbtc",
        outputAddress: string,
        isCredit = false,
    ) => {
        const holder = await impersonate(holderAddress)
        const saveAddress = input === "musd" ? imusdAddress : imbtcAddress
        let inputAddress = input === "musd" ? musdAddress : mbtcAddress

        if (input === "musd" && isCredit) {
            inputAddress = imusdAddress
        } else if (input === "musd" && !isCredit) {
            inputAddress = musdAddress
        } else if (input !== "musd" && isCredit) {
            inputAddress = imbtcAddress
        } else {
            inputAddress = mbtcAddress
        }

        const amount = input === "musd" ? simpleToExactAmount(1, 18) : simpleToExactAmount(1, 14)

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
        expect(amountOut.toString().length).to.be.gte(input === "musd" ? 18 : 4)
        const minAmountOut = amountOut.mul(98).div(1e2)
        const outContract = IERC20__factory.connect(config.output, holder)
        const tokenBalanceBefore = await outContract.balanceOf(holderAddress)
        const saveContract =
            input === "musd"
                ? SavingsContractImusdMainnet21__factory.connect(saveAddress, holder)
                : SavingsContractImbtcMainnet21__factory.connect(saveAddress, holder)

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
        const tokenBalanceDifference = tokenBalanceAfter.sub(tokenBalanceBefore)
        assertBNClosePercent(tokenBalanceDifference, amountOut, 0.001)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
    }

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        // Nov-25-2021 03:15:21 PM +UTC
                        blockNumber: 13684204,
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

    context("Stage 1", () => {
        it("Deploys the unwrapper proxy contract ", async () => {
            unwrapper = await deployContract<Unwrapper>(new Unwrapper__factory(deployer), "Unwrapper", [nexusAddress])
            expect(unwrapper.address).to.length(42)

            // approve tokens for router
            const routers = [alusdFeederPool, hbtcFeederPool]
            const tokens = [musdAddress, mbtcAddress]
            await unwrapper.connect(governor).approve(routers, tokens)
        })
    })

    context("Stage 2", () => {
        describe("2.1 Upgrading vaults", () => {
            it("Upgrades the imUSD Vault", async () => {
                const saveVaultImpl = await deployContract<BoostedSavingsVaultImusdMainnet2>(
                    new BoostedSavingsVaultImusdMainnet2__factory(deployer),
                    "mStable: mUSD Savings Vault",
                    [],
                )
                await upgradeContract<BoostedSavingsVaultImusdMainnet2>(
                    BoostedSavingsVaultImusdMainnet2__factory as unknown as ContractFactory,
                    saveVaultImpl,
                    imusdVaultAddress,
                    governor,
                    delayedProxyAdmin,
                )
                expect(await delayedProxyAdmin.getProxyImplementation(imusdVaultAddress)).eq(saveVaultImpl.address)
            })

            it("Upgrades the imBTC Vault", async () => {
                const priceCoeff = simpleToExactAmount(4800, 18)
                const boostCoeff = 9

                const saveVaultImpl = await deployContract<BoostedSavingsVaultImbtcMainnet2>(
                    new BoostedSavingsVaultImbtcMainnet2__factory(deployer),
                    "mStable: mBTC Savings Vault",
                    [nexusAddress, imbtcAddress, boostDirector, priceCoeff, boostCoeff, mtaAddress],
                )
                await upgradeContract<BoostedSavingsVaultImbtcMainnet2>(
                    BoostedSavingsVaultImbtcMainnet2__factory as unknown as ContractFactory,
                    saveVaultImpl,
                    imbtcVaultAddress,
                    governor,
                    delayedProxyAdmin,
                )
                expect(await delayedProxyAdmin.getProxyImplementation(imbtcVaultAddress)).eq(saveVaultImpl.address)
            })
        })
        describe("2.2 Upgrading savings contracts", () => {
            it("Upgrades the imUSD contract", async () => {
                const musdSaveImpl = await deployContract<SavingsContractImusdMainnet21>(
                    new SavingsContractImusdMainnet21__factory(deployer),
                    "mStable: mUSD Savings Contract",
                    [],
                )

                // const upgradeData = musdSaveImpl.interface.encodeFunctionData("upgradeV3", [unwrapper.address])
                // Method upgradeV3 is for test purposes only
                /**
                 solidity code
                function upgradeV3(address _unwrapper) external {
                    // TODO - REMOVE BEFORE DEPLOYMENT
                    require(_unwrapper != address(0), "Invalid unwrapper address");
                    unwrapper = _unwrapper;
                }
                 */

                const upgradeData = []

                const saveContractProxy = await upgradeContract<SavingsContractImusdMainnet21>(
                    SavingsContractImusdMainnet21__factory as unknown as ContractFactory,
                    musdSaveImpl,
                    imusdAddress,
                    governor,
                    delayedProxyAdmin,
                    upgradeData,
                )

                const unwrapperAddress = await saveContractProxy.unwrapper()
                expect(unwrapperAddress).to.eq(unwrapper.address)
                expect(await delayedProxyAdmin.getProxyImplementation(imusdAddress)).eq(musdSaveImpl.address)
                expect(musdAddress).eq(await musdSaveImpl.underlying())
            })

            it("imUSD contract works after upgraded", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress)
            })

            it("Upgrades the imBTC contract", async () => {
                const constructorArguments = [nexusAddress, mbtcAddress, unwrapper.address]
                const mbtcSaveImpl = await deployContract<SavingsContractImbtcMainnet21>(
                    new SavingsContractImbtcMainnet21__factory(deployer),
                    "mStable: mBTC Savings",
                    constructorArguments,
                )

                const saveContractProxy = await upgradeContract<SavingsContractImbtcMainnet21>(
                    SavingsContractImbtcMainnet21__factory as unknown as ContractFactory,
                    mbtcSaveImpl,
                    imbtcAddress,
                    governor,
                    delayedProxyAdmin,
                )
                expect(await delayedProxyAdmin.getProxyImplementation(imbtcAddress)).eq(mbtcSaveImpl.address)
                const unwrapperAddress = await saveContractProxy.unwrapper()
                expect(unwrapperAddress).to.eq(unwrapper.address)
            })

            it("imBTC contract works after upgraded", async () => {
                await redeemAndUnwrap(imbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress)
            })
        })
    })

    context("Stage 3", () => {
        describe("3.1 Directly", () => {
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
                expect(output.toString()).to.be.length(19)
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
                    router: alusdFeederPool,
                    input: musdAddress,
                    output: alusdAddress,
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
                await redeemAndUnwrap(imusdHolderAddress, alusdFeederPool, "musd", alusdAddress)
            })
            it("mBTC contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress)
            })

            it("mBTC contract redeem to fAsset", async () => {
                await redeemAndUnwrap(imbtcHolderAddress, hbtcFeederPool, "mbtc", hbtcAddress)
            })
            // credits
            it("imUSD contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress, true)
            })

            it("imUSD contract redeem to fAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, alusdFeederPool, "musd", alusdAddress, true)
            })
            it("imBTC contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress, true)
            })

            it("imBTC contract redeem to fAsset", async () => {
                await redeemAndUnwrap(imbtcHolderAddress, hbtcFeederPool, "mbtc", hbtcAddress, true)
            })
        })

        describe("3.3 Via Vaults", () => {
            const withdrawAndUnwrap = async (holderAddress: string, router: string, input: "musd" | "mbtc", outputAddress: string) => {
                const isCredit = true
                const holder = await impersonate(holderAddress)
                const vaultAddress = input === "musd" ? imusdVaultAddress : imbtcVaultAddress
                const inputAddress = input === "musd" ? imusdAddress : imbtcAddress
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
                const saveVault =
                    input === "musd"
                        ? BoostedSavingsVaultImusdMainnet2__factory.connect(vaultAddress, holder)
                        : BoostedSavingsVaultImbtcMainnet2__factory.connect(vaultAddress, holder)
                await saveVault.withdrawAndUnwrap(config.amount, minAmountOut, config.output, holderAddress, config.router, isBassetOut)

                const tokenBalanceAfter = await outContract.balanceOf(holderAddress)
                const tokenBalanceDifference = tokenBalanceAfter.sub(tokenBalanceBefore)
                assertBNClosePercent(tokenBalanceDifference, amountOut, 0.001)
                expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
            }

            it("imUSD Vault redeem to bAsset", async () => {
                await withdrawAndUnwrap(vmusdHolderAddress, musdAddress, "musd", daiAddress)
            })

            it("imUSD Vault redeem to fAsset", async () => {
                await withdrawAndUnwrap(vmusdHolderAddress, alusdFeederPool, "musd", alusdAddress)
            })
            it("imBTC Vault redeem to bAsset", async () => {
                await withdrawAndUnwrap(vmbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress)
            })

            it("imBTC Vault redeem to fAsset", async () => {
                await withdrawAndUnwrap(vhbtcmbtcHolderAddress, hbtcFeederPool, "mbtc", hbtcAddress)
            })

            it("Emits referrer successfully", async () => {
                const saveContractProxy = SavingsContractImusdMainnet21__factory.connect(imusdAddress, musdHolder)
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
    })
})
