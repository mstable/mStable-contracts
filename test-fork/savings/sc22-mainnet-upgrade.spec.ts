import { impersonate, setBalance } from "@utils/fork"
import { Signer, ContractFactory } from "ethers"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"

// Mainnet imBTC Contract
import { SavingsContractImbtcMainnet22__factory } from "types/generated/factories/SavingsContractImbtcMainnet22__factory"
import { SavingsContractImbtcMainnet22 } from "types/generated/SavingsContractImbtcMainnet22"
// Mainnet imUSD Contract
import { SavingsContractImusdMainnet22__factory } from "types/generated/factories/SavingsContractImusdMainnet22__factory"
import { SavingsContractImusdMainnet22 } from "types/generated/SavingsContractImusdMainnet22"

import { DelayedProxyAdmin, DelayedProxyAdmin__factory, IERC20, IERC20__factory, Unwrapper, Unwrapper__factory } from "types/generated"

import { assertBNClosePercent, Chain, ZERO_ADDRESS, simpleToExactAmount } from "index"
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
const imbtcHolderAddress = "0x720366c95d26389471c52f854d43292157c03efd"
const daiAddress = resolveAddress("DAI", Chain.mainnet)
const alusdAddress = resolveAddress("alUSD", Chain.mainnet)
const musdAddress = resolveAddress("mUSD", Chain.mainnet)
const imusdAddress = resolveAddress("mUSD", Chain.mainnet, "savings")
const alusdFeederPool = resolveAddress("alUSD", Chain.mainnet, "feederPool")
const mbtcAddress = resolveAddress("mBTC", Chain.mainnet)
const imbtcAddress = resolveAddress("mBTC", Chain.mainnet, "savings")
const wbtcAddress = resolveAddress("WBTC", Chain.mainnet)
const hbtcAddress = resolveAddress("HBTC", Chain.mainnet)
const hbtcFeederPool = resolveAddress("HBTC", Chain.mainnet, "feederPool")

// DEPLOYMENT PIPELINE
//  1. Upgrade and check storage
//   1.1. SavingsContracts
//  2. Do some unwrapping
//   2.1. Directly to unwrapper
//   2.2. Via SavingsContracts
//  3. Test ERC4626 on SavingsContracts
context("SavingContract Vault4626 upgrades", () => {
    let deployer: Signer
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
                        // Apr-17-2022 01:54:24 AM +UTC
                        blockNumber: 14600000,
                    },
                },
            ],
        })
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
        unwrapper = await Unwrapper__factory.connect(unwrapperAddress, deployer)

        // Set underlying assets balance for testing
        await setBalance(
            imbtcHolderAddress,
            mbtcAddress,
            simpleToExactAmount(1000, 14),
            "0x6cb417529ba9d523d90ee650ef76cc0b9eccfd19232ffb9510f634b1fa3ecfaf",
        )
        await setBalance(
            imusdHolderAddress,
            musdAddress,
            simpleToExactAmount(1000, 18),
            "0xe5fabcd29e7e9410c7da27fc68f987954a0ad327fe34ba95056b7880fd70df35",
        )
        // Set savings contract balance for testing
        await setBalance(
            imbtcHolderAddress,
            imbtcAddress,
            simpleToExactAmount(1000, 14),
            "0x6cb417529ba9d523d90ee650ef76cc0b9eccfd19232ffb9510f634b1fa3ecfaf",
        )
        await setBalance(
            imusdHolderAddress,
            imusdAddress,
            simpleToExactAmount(1000, 18),
            "0xe5fabcd29e7e9410c7da27fc68f987954a0ad327fe34ba95056b7880fd70df35",
        )
    })
    it("Test connectivity", async () => {
        const startEther = await deployer.getBalance()
        const address = await deployer.getTransactionCount()
        console.log(`Deployer ${address} has ${startEther} Ether`)
    })

    context("Stage 1", () => {
        describe("1.1 Upgrading savings contracts", () => {
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
                expect(await saveContractProxy.unwrapper(), "unwrapper").to.eq(unwrapper.address)
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

    context("Stage 2 (regression)", () => {
        describe("2.1 Via SavingsContracts", () => {
            before("fund accounts", async () => {
                const imusdHolder = await impersonate(imusdHolderAddress)
                const imbtcHolder = await impersonate(imbtcHolderAddress)

                const savingsContractImusd = SavingsContractImusdMainnet22__factory.connect(imusdAddress, imusdHolder)
                const savingsContractImbtc = SavingsContractImbtcMainnet22__factory.connect(imbtcAddress, imbtcHolder)

                const musd = IERC20__factory.connect(musdAddress, imusdHolder)
                const mbtc = IERC20__factory.connect(mbtcAddress, imbtcHolder)

                await musd.approve(savingsContractImusd.address, simpleToExactAmount(1, 21))
                await mbtc.approve(savingsContractImbtc.address, simpleToExactAmount(1, 18))

                await savingsContractImusd["deposit(uint256,address)"](simpleToExactAmount(100), imusdHolderAddress)
                await savingsContractImbtc["deposit(uint256,address)"](simpleToExactAmount(10, 14), imbtcHolderAddress)
            })
            it("mUSD contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, musdAddress, "musd", daiAddress)
            })

            it.skip("mUSD contract redeem to fAsset", async () => {
                await redeemAndUnwrap(imusdHolderAddress, alusdFeederPool, "musd", alusdAddress)
            })
            it("mBTC contract redeem to bAsset", async () => {
                await redeemAndUnwrap(imbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress)
            })

            it.skip("mBTC contract redeem to fAsset", async () => {
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
    })

    context("Stage 3 Savings Contract ERC4626", () => {
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
            let sharesAmount: BigNumber
            let sharesBalance: BigNumber
            let assetsBalance: BigNumber
            let underlyingSaveContractBalance: BigNumber
            let anotherUnderlyingBalance: BigNumber

            async function getBalances() {
                underlyingSaveContractBalance = await asset.balanceOf(ctxSaveContract.address)
                anotherUnderlyingBalance = await asset.balanceOf(anotherHolderAddress)

                sharesBalance = await ctxSaveContract.balanceOf(holderAddress)
                assetsBalance = await ctxSaveContract.convertToAssets(sharesBalance)
                sharesAmount = await ctxSaveContract.convertToShares(assetsAmount)
            }
            before(async () => {
                if (sc.name === "imusd") {
                    holder = await impersonate(imusdHolderAddress)
                    anotherHolder = await impersonate(imbtcHolderAddress)
                    ctxSaveContract = SavingsContractImusdMainnet22__factory.connect(sc.address, holder)
                    assetAddress = musdAddress
                    assetsAmount = simpleToExactAmount(1, 18)
                } else {
                    holder = await impersonate(imbtcHolderAddress)
                    anotherHolder = await impersonate(imusdHolderAddress)
                    ctxSaveContract = SavingsContractImbtcMainnet22__factory.connect(sc.address, holder)
                    assetAddress = mbtcAddress
                    assetsAmount = simpleToExactAmount(1, 14)
                }
                holderAddress = await holder.getAddress()
                anotherHolderAddress = await anotherHolder.getAddress()
                asset = IERC20__factory.connect(assetAddress, holder)
            })
            beforeEach(async () => {
                await getBalances()
            })
            describe(`SaveContract ${sc.name}`, async () => {
                it("should properly store valid arguments", async () => {
                    expect(await ctxSaveContract.asset(), "asset").to.eq(assetAddress)
                })
                describe("deposit", async () => {
                    it("should deposit assets to the vault", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        let shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        expect(await ctxSaveContract.maxDeposit(holderAddress), "max deposit").to.gte(assetsAmount)
                        expect(await ctxSaveContract.maxMint(holderAddress), "max mint").to.gte(shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)
                        expect(await ctxSaveContract.convertToShares(assetsAmount), "convertToShares").to.lte(shares)

                        // Test
                        const tx = await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        // Exchange rate update
                        shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.emit(ctxSaveContract, "Deposit").withArgs(holderAddress, holderAddress, assetsAmount, shares)
                        assertBNClosePercent(await ctxSaveContract.maxRedeem(holderAddress), sharesBalance.add(shares), 0.01)
                        assertBNClosePercent(await ctxSaveContract.maxWithdraw(holderAddress), assetsBalance.add(assetsAmount), 0.01)
                        assertBNClosePercent(await ctxSaveContract.totalAssets(), underlyingSaveContractBalance.add(assetsAmount), 0.1)
                    })
                    it("should deposit assets with referral", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        let shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        expect(await ctxSaveContract.maxDeposit(holderAddress), "max deposit").to.gte(assetsAmount)
                        expect(await ctxSaveContract.maxMint(holderAddress), "max mint").to.gte(shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)
                        expect(await ctxSaveContract.convertToShares(assetsAmount), "convertToShares").to.lte(shares)

                        // Test
                        const tx = await ctxSaveContract
                            .connect(holder)
                            ["deposit(uint256,address,address)"](assetsAmount, holderAddress, anotherHolderAddress)

                        shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.emit(ctxSaveContract, "Deposit").withArgs(holderAddress, holderAddress, assetsAmount, shares)
                        await expect(tx).to.emit(ctxSaveContract, "Referral").withArgs(anotherHolderAddress, holderAddress, assetsAmount)

                        assertBNClosePercent(await ctxSaveContract.maxRedeem(holderAddress), sharesBalance.add(shares), 0.01)
                        assertBNClosePercent(await ctxSaveContract.maxWithdraw(holderAddress), assetsBalance.add(assetsAmount), 0.01)
                        assertBNClosePercent(await ctxSaveContract.totalAssets(), underlyingSaveContractBalance.add(assetsAmount), 0.1)
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

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        expect(await ctxSaveContract.convertToShares(assets), "convertToShares").to.lte(shares)
                        expect(await ctxSaveContract.convertToAssets(shares), "convertToAssets").to.lte(assets)

                        const tx = await ctxSaveContract.connect(holder)["mint(uint256,address)"](shares, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.emit(ctxSaveContract, "Deposit").withArgs(holderAddress, holderAddress, assets, shares)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))
                    })
                    it("should mint shares with referral", async () => {
                        await asset.approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        // const shares = sharesAmount
                        const assets = await ctxSaveContract.previewMint(sharesAmount)
                        const shares = await ctxSaveContract.previewDeposit(assetsAmount)

                        expect(await ctxSaveContract.maxDeposit(holderAddress), "max deposit").to.gte(assets)
                        expect(await ctxSaveContract.maxMint(holderAddress), "max mint").to.gte(shares)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        expect(await ctxSaveContract.convertToShares(assets), "convertToShares").to.lte(shares)
                        expect(await ctxSaveContract.convertToAssets(shares), "convertToAssets").to.lte(assets)

                        const tx = await ctxSaveContract
                            .connect(holder)
                            ["mint(uint256,address,address)"](shares, holderAddress, anotherHolderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx).to.emit(ctxSaveContract, "Deposit").withArgs(holderAddress, holderAddress, assets, shares)
                        await expect(tx).to.emit(ctxSaveContract, "Referral").withArgs(anotherHolderAddress, holderAddress, assetsAmount)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))
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

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        assertBNClosePercent(await ctxSaveContract.maxWithdraw(holderAddress), assetsBalance.add(assetsAmount), 0.01)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.gte(underlyingSaveContractBalance.sub(assetsAmount))
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))

                        await getBalances()
                        // Test
                        const tx = await ctxSaveContract.connect(holder).withdraw(assetsAmount, holderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, holderAddress, holderAddress, assetsAmount, shares)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.sub(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
                    })
                    it("from the vault, caller != receiver and caller = owner", async () => {
                        // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))

                        await getBalances()
                        // Test
                        const tx = await ctxSaveContract.connect(holder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, anotherHolderAddress, holderAddress, assetsAmount, shares)
                        expect(await asset.balanceOf(anotherHolderAddress), "another holder balance").to.eq(
                            anotherUnderlyingBalance.add(assetsAmount),
                        )
                        expect(await ctxSaveContract.balanceOf(holderAddress), "holder balance").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
                    })
                    it("from the vault caller != owner, infinite approval", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, ethers.constants.MaxUint256)
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, ethers.constants.MaxUint256)

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))

                        await getBalances()
                        // Test
                        const tx = await ctxSaveContract.connect(anotherHolder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assetsAmount, shares)

                        expect(await asset.balanceOf(anotherHolderAddress), "another holder balance").to.eq(
                            anotherUnderlyingBalance.add(assetsAmount),
                        )
                        expect(await ctxSaveContract.balanceOf(holderAddress), "holder balance").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
                    })
                    it("from the vault, caller != receiver and caller != owner", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, simpleToExactAmount(1, 21))

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))
                        const shares = await ctxSaveContract.previewWithdraw(assetsAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))

                        await getBalances()
                        // Test
                        const tx = await ctxSaveContract.connect(anotherHolder).withdraw(assetsAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assetsAmount, shares)
                        expect(await asset.balanceOf(anotherHolderAddress), "another holder balance").to.eq(
                            anotherUnderlyingBalance.add(assetsAmount),
                        )
                        expect(await ctxSaveContract.balanceOf(holderAddress), "holder balance").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
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
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, 0)

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))

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
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.add(sharesAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))

                        await getBalances()

                        // Test
                        const tx = await ctxSaveContract
                            .connect(holder)
                            ["redeem(uint256,address,address)"](sharesAmount, holderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, holderAddress, holderAddress, assets, sharesAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.sub(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
                    })
                    it("from the vault, caller != receiver and caller = owner", async () => {
                        // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)

                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assetsAmount, holderAddress)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))

                        await getBalances()

                        // Test
                        const tx = await ctxSaveContract
                            .connect(holder)
                            ["redeem(uint256,address,address)"](sharesAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(holderAddress, anotherHolderAddress, holderAddress, assets, sharesAmount)
                        expect(await ctxSaveContract.maxRedeem(holderAddress), "max redeem").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.sub(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
                    })
                    it("from the vault caller != owner, infinite approval", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, ethers.constants.MaxUint256)
                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)

                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))

                        await getBalances()
                        // Test
                        const tx = await ctxSaveContract
                            .connect(anotherHolder)
                            ["redeem(uint256,address,address)"](sharesAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assets, sharesAmount)
                        expect(await asset.balanceOf(anotherHolderAddress), "another holder balance").to.eq(
                            anotherUnderlyingBalance.add(assetsAmount),
                        )
                        expect(await ctxSaveContract.balanceOf(holderAddress), "holder balance").to.eq(sharesBalance.sub(sharesAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
                    })
                    it("from the vault, caller != receiver and caller != owner", async () => {
                        // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
                        await asset.connect(holder).approve(ctxSaveContract.address, simpleToExactAmount(1, 21))
                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, simpleToExactAmount(1, 21))
                        const assets = await ctxSaveContract.previewRedeem(sharesAmount)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance)

                        await ctxSaveContract.connect(holder)["deposit(uint256,address)"](assets, holderAddress)
                        expect(await ctxSaveContract.maxWithdraw(holderAddress), "max withdraw").to.eq(assetsBalance.add(assetsAmount))
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.add(assetsAmount))

                        await getBalances()
                        // Test
                        const tx = await ctxSaveContract
                            .connect(anotherHolder)
                            ["redeem(uint256,address,address)"](sharesAmount, anotherHolderAddress, holderAddress)
                        // Verify events, storage change, balance, etc.
                        await expect(tx)
                            .to.emit(ctxSaveContract, "Withdraw")
                            .withArgs(anotherHolderAddress, anotherHolderAddress, holderAddress, assets, sharesAmount)

                        expect(await ctxSaveContract.maxRedeem(anotherHolderAddress), "max redeem").to.eq(0)
                        expect(await ctxSaveContract.maxWithdraw(anotherHolderAddress), "max withdraw").to.eq(0)
                        expect(await ctxSaveContract.totalAssets(), "totalAssets").to.eq(underlyingSaveContractBalance.sub(assetsAmount))
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

                        await ctxSaveContract.connect(holder).approve(anotherHolderAddress, 0)
                        expect(await ctxSaveContract.connect(holder).allowance(holderAddress, anotherHolderAddress), "allowance").to.eq(0)
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
