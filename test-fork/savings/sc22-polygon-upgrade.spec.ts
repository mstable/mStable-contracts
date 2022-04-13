import { impersonate } from "@utils/fork"
import { Signer, ContractFactory } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
// Polygon imUSD Vault
import { StakingRewardsWithPlatformTokenImusdPolygon2__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon2__factory"

// Polygon imUSD Contract
import { SavingsContractImusdPolygon22__factory } from "types/generated/factories/SavingsContractImusdPolygon22__factory"
import { SavingsContractImusdPolygon22 } from "types/generated/SavingsContractImusdPolygon22"

import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    IERC20__factory,
    Unwrapper,
    Unwrapper__factory,
    IERC20,
} from "types/generated"

import { assertBNClosePercent, Chain, DEAD_ADDRESS, ZERO_ADDRESS, simpleToExactAmount, safeInfinity } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress, resolveAddress } from "tasks/utils/networkAddressFactory"
import { upgradeContract } from "@utils/deploy"

const chain = Chain.polygon
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = resolveAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)
const deployerAddress = getChainAddress("OperationsSigner", chain)
const unwrapperAddress = getChainAddress("Unwrapper", chain)

const imusdHolderAddress = "0x9d8B7A637859668A903797D9f02DE2Aa05e5b0a0"
const musdHolderAddress = "0xb14fFDB81E804D2792B6043B90aE5Ac973EcD53D"
const vmusdHolderAddress = "0x9d8B7A637859668A903797D9f02DE2Aa05e5b0a0"

const daiAddress = resolveAddress("DAI", chain)
const fraxAddress = resolveAddress("FRAX", chain)
const musdAddress = resolveAddress("mUSD", chain)
const imusdAddress = resolveAddress("mUSD", chain, "savings")
const imusdVaultAddress = resolveAddress("mUSD", chain, "vault")
const fraxFeederPool = resolveAddress("FRAX", chain, "feederPool")

// DEPLOYMENT PIPELINE
//  1. Connects Unwrapper
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
        const saveContract = SavingsContractImusdPolygon22__factory.connect(saveAddress, holder)

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
        it("Connects the unwrapper proxy contract ", async () => {
            unwrapper = await Unwrapper__factory.connect(unwrapperAddress, deployer)
        })
    })

    context("Stage 2", () => {
        describe("2.2 Upgrading savings contracts", () => {
            it("Upgrades the imUSD contract", async () => {
                const constructorArguments = [nexusAddress, musdAddress, unwrapper.address]
                const musdSaveImpl = await deployContract<SavingsContractImusdPolygon22>(
                    new SavingsContractImusdPolygon22__factory(deployer),
                    "mStable: mUSD Savings Contract",
                    constructorArguments,
                )
                const saveContractProxy = await upgradeContract<SavingsContractImusdPolygon22>(
                    SavingsContractImusdPolygon22__factory as unknown as ContractFactory,
                    musdSaveImpl,
                    imusdAddress,
                    governor,
                    delayedProxyAdmin,
                )

                expect(await saveContractProxy.unwrapper()).to.eq(unwrapper.address)
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
                const saveContractProxy = SavingsContractImusdPolygon22__factory.connect(imusdAddress, musdHolder)
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
    context("Stage 4 Savings Contract Vault4626", () => {
        const saveContracts = [{ name: "imusd", address: imusdAddress }]

        saveContracts.forEach((sc) => {
            let ctxSaveContract: SavingsContractImusdPolygon22
            let assetAddress: string
            let holderAddress: string
            let anotherHolderAddress: string
            let asset: IERC20
            let holder: Signer
            let anotherHolder: Signer
            let assetsAmount = simpleToExactAmount(10, 18)
            let sharesAmount = simpleToExactAmount(100, 18)

            before(async () => {
                if (sc.name === "imusd") {
                    holder = await impersonate(imusdHolderAddress)
                    anotherHolder = await impersonate(musdHolderAddress)
                    ctxSaveContract = SavingsContractImusdPolygon22__factory.connect(sc.address, holder)
                    assetAddress = musdAddress
                    assetsAmount = simpleToExactAmount(1, 18)
                    sharesAmount = simpleToExactAmount(10, 18)
                } else {
                    // not needed now.
                }
                holderAddress = await holder.getAddress()
                anotherHolderAddress = await anotherHolder.getAddress()
                asset = IERC20__factory.connect(assetAddress, holder)
            })
            describe(`SaveContract ${sc.name}`, async () => {
                it("should properly store valid arguments", async () => {
                    expect(await ctxSaveContract.asset(), "asset").to.eq(assetAddress)
                })
                describe("deposit", async () => {
                    it("should deposit assets to the vault", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        const shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        expect(await ctxSaveContract.maxDeposit(holderAddress), "max deposit").to.gte(assetsAmount)
                        expect(await ctxSaveContract.maxMint(holderAddress), "max mint").to.gte(shares)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                        expect(await ctxSaveContract.convertToShares(assetsAmount), "convertToShares").to.lte(shares)

                        // Test
                        const tx = await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.emit(ctxSaveContract, "Deposit").withArgs(holderAddress, holderAddress, assetsAmount, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.lte(shares)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.lte(assetsAmount)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(assetsAmount)
                    })
                    it("fails if deposits zero", async () => {
                        await expect(ctxSaveContract.connect(deployer)["deposit(uint256,address)"](0, holderAddress)).to.be.revertedWith(
                            "Must deposit something",
                        )
                    })
                    it("fails if receiver is zero", async () => {
                        await expect(ctxSaveContract.connect(deployer)["deposit(uint256,address)"](10, ZERO_ADDRESS)).to.be.revertedWith(
                            "Invalid beneficiary address",
                        )
                    })
                })
                describe("mint", async () => {
                    it("should mint shares to the vault", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        // const shares = sharesAmount
                        const assets = await ctxSaveContract.previewMint(sharesAmount)
                        const shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        expect(await ctxSaveContract.maxDeposit(holderAddress), "max deposit").to.gte(assets)
                        expect(await ctxSaveContract.maxMint(holderAddress), "max mint").to.gte(shares)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        expect(await ctxSaveContract.convertToShares(assets), "convertToShares").to.lte(shares)
                        expect(await ctxSaveContract.convertToAssets(shares), "convertToShares").to.lte(assets)

                        const tx = await ctxSaveContract.connect(holder).mint(shares, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.emit(ctxSaveContract, "Deposit").withArgs(holderAddress, holderAddress, assets, shares)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.lte(shares)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.lte(assets)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(assets)
                    })
                    it("fails if mint zero", async () => {
                        await expect(ctxSaveContract.connect(deployer)["mint(uint256,address)"](0, holderAddress)).to.be.revertedWith(
                            "Must deposit something",
                        )
                    })
                    it("fails if receiver is zero", async () => {
                        await expect(ctxSaveContract.connect(deployer)["mint(uint256,address)"](10, ZERO_ADDRESS)).to.be.revertedWith(
                            "Invalid beneficiary address",
                        )
                    })
                })
                describe("withdraw", async () => {
                    it("from the vault, same caller, receiver and owner", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(shares)

                        // Test
                        const tx = await ctxSaveContract.connect(holder).withdraw(assetsAmount, holderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, holderAddress, holderAddress, assetsAmount, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("from the vault, caller != receiver and caller = owner", async () => {
                        // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(shares)

                        // Test
                        const tx = await ctxSaveContract.connect(holder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, anotherHolderAddress, holderAddress, assetsAmount, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("from the vault caller != owner, infinite approval", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, safeInfinity)

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(shares)

                        // Test
                        const tx = await ctxSaveContract.connect(anotherHolder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assetsAmount, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("from the vault, caller != receiver and caller != owner", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, simpleToExactAmount(1, 21))

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(shares)

                        // Test
                        const tx = await ctxSaveContract.connect(anotherHolder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assetsAmount, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("fails if deposits zero", async () => {
                        await expect(ctxSaveContract.connect(deployer).withdraw(0, holderAddress, holderAddress)).to.be.revertedWith(
                            "Must withdraw something",
                        )
                    })
                    it("fails if receiver is zero", async () => {
                        await expect(ctxSaveContract.connect(deployer).withdraw(10, ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
                            "Invalid beneficiary address",
                        )
                    })
                    it("fail if caller != owner and it has not allowance", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(shares)

                        // Test
                        const tx = ctxSaveContract.connect(anotherHolder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.be.revertedWith("Amount exceeds allowance")
                    })
                })
                describe("redeem", async () => {
                    it("from the vault, same caller, receiver and owner", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))

                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max maxRedeem").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max maxRedeem").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.maxRedeem(holderAddress)

                        // Test
                        const tx = await ctxSaveContract
                            .connect(holder)
                            ["redeem(uint256,address,address)"](shares, holderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, holderAddress, holderAddress, assets, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("from the vault, caller != receiver and caller = owner", async () => {
                        // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assets)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.maxRedeem(holderAddress)

                        // Test
                        const tx = await ctxSaveContract
                            .connect(holder)
                            ["redeem(uint256,address,address)"](shares, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, anotherHolderAddress, holderAddress, assets, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("from the vault caller != owner, infinite approval", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, safeInfinity)
                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.maxRedeem(holderAddress)

                        // Test
                        const tx = await ctxSaveContract
                            .connect(anotherHolder)
                            ["redeem(uint256,address,address)"](shares, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assets, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("from the vault, caller != receiver and caller != owner", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, simpleToExactAmount(1, 21))

                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.gt(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gt(0)
                        const shares = await ctxSaveContract.maxRedeem(holderAddress)

                        // Test
                        const tx = await ctxSaveContract
                            .connect(anotherHolder)
                            ["redeem(uint256,address,address)"](shares, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assets, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(0)
                    })
                    it("fails if deposits zero", async () => {
                        await expect(
                            ctxSaveContract.connect(deployer)["redeem(uint256,address,address)"](0, holderAddress, holderAddress),
                        ).to.be.revertedWith("Must withdraw something")
                    })
                    it("fails if receiver is zero", async () => {
                        await expect(
                            ctxSaveContract.connect(deployer)["redeem(uint256,address,address)"](10, ZERO_ADDRESS, ZERO_ADDRESS),
                        ).to.be.revertedWith("Invalid beneficiary address")
                    })
                    it("fail if caller != owner and it has not allowance", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)
                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        // Test
                        const tx = ctxSaveContract
                            .connect(anotherHolder)
                            ["redeem(uint256,address,address)"](sharesAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.be.revertedWith("Amount exceeds allowance")
                    })
                })
            })
        })
    })
})
