import { impersonate } from "@utils/fork"
import { Signer, ContractFactory } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"

// Mainnet imBTC Vault
import { BoostedSavingsVaultImbtcMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet2__factory"

// Mainnet imUSD Vault
import { BoostedSavingsVaultImusdMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet2__factory"

// Mainnet imBTC Contract
import { SavingsContractImbtcMainnet22__factory } from "types/generated/factories/SavingsContractImbtcMainnet22__factory"
import { SavingsContractImbtcMainnet22 } from "types/generated/SavingsContractImbtcMainnet22"
// Mainnet imUSD Contract
import { SavingsContractImusdMainnet22__factory } from "types/generated/factories/SavingsContractImusdMainnet22__factory"
import { SavingsContractImusdMainnet22 } from "types/generated/SavingsContractImusdMainnet22"

import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    IERC20,
    ERC20__factory,
    IERC20__factory,
    Unwrapper,
    Unwrapper__factory,
} from "types/generated"

import { assertBNClosePercent, Chain, DEAD_ADDRESS, ZERO_ADDRESS, simpleToExactAmount, safeInfinity } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress, resolveAddress } from "tasks/utils/networkAddressFactory"
import { upgradeContract } from "@utils/deploy"

const chain = Chain.mainnet
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = getChainAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)
const unwrapperAddress = getChainAddress("Unwrapper", chain)

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
const mbtcAddress = resolveAddress("mBTC", Chain.mainnet)
const imbtcAddress = resolveAddress("mBTC", Chain.mainnet, "savings")
const imbtcVaultAddress = resolveAddress("mBTC", Chain.mainnet, "vault")
const wbtcAddress = resolveAddress("WBTC", Chain.mainnet)
const hbtcAddress = resolveAddress("HBTC", Chain.mainnet)
const hbtcFeederPool = resolveAddress("HBTC", Chain.mainnet, "feederPool")

// DEPLOYMENT PIPELINE
//  1. Connects Unwrapper
//  2. Upgrade and check storage
//   2.2. SavingsContracts
//  3. Do some unwrapping
//   3.1. Directly to unwrapper
//   3.2. Via SavingsContracts
//   3.3. Via SavingsVaults
// 4. Do 4626 SavingsContracts upgrades
context("Unwrapper and Vault4626 upgrades", () => {
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
                ? SavingsContractImusdMainnet22__factory.connect(saveAddress, holder)
                : SavingsContractImbtcMainnet22__factory.connect(saveAddress, holder)

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
                        // Apr-01-2022 11:10:20 AM +UTC
                        blockNumber: 14500000,
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
                const musdSaveImpl = await deployContract<SavingsContractImusdMainnet22>(
                    new SavingsContractImusdMainnet22__factory(deployer),
                    "mStable: mUSD Savings Contract",
                    [],
                )

                const upgradeData = []
                const saveContractProxy = await upgradeContract<SavingsContractImusdMainnet22>(
                    SavingsContractImusdMainnet22__factory as unknown as ContractFactory,
                    musdSaveImpl,
                    imusdAddress,
                    governor,
                    delayedProxyAdmin,
                    upgradeData,
                )

                expect(await saveContractProxy.unwrapper()).to.eq(unwrapper.address)
                expect(await delayedProxyAdmin.getProxyImplementation(imusdAddress)).eq(musdSaveImpl.address)
                expect(musdAddress).eq(await musdSaveImpl.underlying())
            })

            it("imUSD contract works after upgraded", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress)
            })

            it("Upgrades the imBTC contract", async () => {
                const constructorArguments = [nexusAddress, mbtcAddress, unwrapper.address]
                const mbtcSaveImpl = await deployContract<SavingsContractImbtcMainnet22>(
                    new SavingsContractImbtcMainnet22__factory(deployer),
                    "mStable: mBTC Savings",
                    constructorArguments,
                )

                const saveContractProxy = await upgradeContract<SavingsContractImbtcMainnet22>(
                    SavingsContractImbtcMainnet22__factory as unknown as ContractFactory,
                    mbtcSaveImpl,
                    imbtcAddress,
                    governor,
                    delayedProxyAdmin,
                )
                expect(await delayedProxyAdmin.getProxyImplementation(imbtcAddress)).eq(mbtcSaveImpl.address)
                expect(await saveContractProxy.unwrapper()).to.eq(unwrapper.address)
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
                const saveContractProxy = SavingsContractImusdMainnet22__factory.connect(imusdAddress, musdHolder)
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

    context("Stage 4 Savings Contract Vault4626", () => {
        const saveContracts = [
            { name: "imusd", address: imusdAddress },
            { name: "imbtc", address: imbtcAddress },
        ]

        saveContracts.forEach((sc) => {
            let ctxSaveContract: SavingsContractImusdMainnet22 | SavingsContractImbtcMainnet22
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
                    anotherHolder = await impersonate(imbtcHolderAddress)
                    ctxSaveContract = SavingsContractImusdMainnet22__factory.connect(sc.address, holder)
                    assetAddress = musdAddress
                    assetsAmount = simpleToExactAmount(1, 18)
                    sharesAmount = simpleToExactAmount(10, 18)
                } else {
                    holder = await impersonate(imbtcHolderAddress)
                    anotherHolder = await impersonate(imusdHolderAddress)
                    ctxSaveContract = SavingsContractImbtcMainnet22__factory.connect(sc.address, holder)
                    assetAddress = mbtcAddress
                    assetsAmount = simpleToExactAmount(1, 14)
                    sharesAmount = simpleToExactAmount(10, 14)
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
