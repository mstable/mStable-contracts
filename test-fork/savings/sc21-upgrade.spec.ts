import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"

import { BoostedSavingsVaultImusdMainnet1__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet1__factory"
import { BoostedSavingsVaultImusdMainnet1 } from "types/generated/BoostedSavingsVaultImusdMainnet1"
import { BoostedSavingsVaultImusdMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet2__factory"
import { BoostedSavingsVaultImusdMainnet2 } from "types/generated/BoostedSavingsVaultImusdMainnet2"
import { BoostedSavingsVaultImbtcMainnet1__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet1__factory"
import { BoostedSavingsVaultImbtcMainnet1 } from "types/generated/BoostedSavingsVaultImbtcMainnet1"
import { BoostedSavingsVaultImbtcMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet2__factory"
import { BoostedSavingsVaultImbtcMainnet2 } from "types/generated/BoostedSavingsVaultImbtcMainnet2"
import { StakingRewardsWithPlatformTokenImusdPolygon1__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon1__factory"
import { StakingRewardsWithPlatformTokenImusdPolygon1 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon1"
import { StakingRewardsWithPlatformTokenImusdPolygon2__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon2__factory"
import { StakingRewardsWithPlatformTokenImusdPolygon2 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon2"
import { SavingsContractImusdMainnet20__factory } from "types/generated/factories/SavingsContractImusdMainnet20__factory"
import { SavingsContractImusdMainnet20 } from "types/generated/SavingsContractImusdMainnet20"
import { SavingsContractImusdMainnet21__factory } from "types/generated/factories/SavingsContractImusdMainnet21__factory"
import { SavingsContractImusdMainnet21 } from "types/generated/SavingsContractImusdMainnet21"
import { SavingsContractImbtcMainnet20__factory } from "types/generated/factories/SavingsContractImbtcMainnet20__factory"
import { SavingsContractImbtcMainnet20 } from "types/generated/SavingsContractImbtcMainnet20"
import { SavingsContractImusdPolygon20__factory } from "types/generated/factories/SavingsContractImusdPolygon20__factory"
import { SavingsContractImusdPolygon20 } from "types/generated/SavingsContractImusdPolygon20"
import { SavingsContractImusdPolygon21__factory } from "types/generated/factories/SavingsContractImusdPolygon21__factory"
import { SavingsContractImusdPolygon21 } from "types/generated/SavingsContractImusdPolygon21"
import {
    BoostedVault__factory,
    StakingRewardsWithPlatformToken,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    IERC20__factory,
    Nexus__factory,
    SavingsContract,
    SavingsContract__factory,
    Unwrapper,
    Unwrapper__factory,
} from "types/generated"
import { Chain, DEAD_ADDRESS, increaseTime, ONE_WEEK, simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress, resolveAddress } from "tasks/utils/networkAddressFactory"

const chain = Chain.mainnet
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = getChainAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)
const boostDirector = getChainAddress("BoostDirector", chain)

const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const imusdHolderAddress = "0xdA1fD36cfC50ED03ca4dd388858A78C904379fb3"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
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
//   1.1. Set the Unwrapper address as constant in imUSD Vault
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
    let imusdHolder: Signer
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
                        blockNumber: 13684204,
                    },
                },
            ],
        })
        musdHolder = await impersonate(musdHolderAddress)
        imusdHolder = await impersonate(imusdHolderAddress)
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

                await delayedProxyAdmin.proposeUpgrade(imusdVaultAddress, saveVaultImpl.address, "0x")
                await increaseTime(ONE_WEEK.add(60))

                // check request is correct
                const request = await delayedProxyAdmin.requests(imusdVaultAddress)
                expect(request.implementation).eq(saveVaultImpl.address)

                // accept upgrade
                await delayedProxyAdmin.acceptUpgradeRequest(imusdVaultAddress)

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

                await delayedProxyAdmin.proposeUpgrade(imbtcVaultAddress, saveVaultImpl.address, "0x")
                await increaseTime(ONE_WEEK.add(60))

                // check request is correct
                const request = await delayedProxyAdmin.requests(imbtcVaultAddress)
                expect(request.implementation).eq(saveVaultImpl.address)

                // accept upgrade
                await delayedProxyAdmin.acceptUpgradeRequest(imbtcVaultAddress)

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

                // expect(await delayedProxyAdmin.callStatic.nexus(), "nexus not match").to.eq(nexusAddress)
                // expect(await Nexus__factory.connect(nexusAddress, governor).callStatic.governor(), "governor not match").to.eq(
                //     governorAddress,
                // )

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
                // expect(unwrapperAddress).to.eq(unwrapper.address)
            })

            // it("imUSD contract works after upgraded", async () => {
            //     const imusdHolder = await impersonate(imusdHolderAddress)

            //     const config = {
            //         router: musdAddress,
            //         input: musdAddress,
            //         output: daiAddress,
            //         amount: simpleToExactAmount(1, 18),
            //     }

            //     // Get estimated output via getUnwrapOutput
            //     const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.output)
            //     const amountOut = await unwrapper.getUnwrapOutput(isBassetOut, config.router, config.input, config.output, config.amount)
            //     expect(amountOut.toString().length).to.be.gte(18)
            //     const minAmountOut = amountOut.mul(98).div(1e2)

            //     // dai balance before
            //     const daiBalanceBefore = await IERC20__factory.connect(daiAddress, imusdHolder).balanceOf(imusdHolderAddress)

            //     const saveContractProxy = SavingsContract__factory.connect(imusdAddress, imusdHolder)
            //     await saveContractProxy.redeemAndUnwrap(
            //         config.amount,
            //         false,
            //         minAmountOut,
            //         config.output,
            //         imusdHolderAddress,
            //         config.router,
            //         isBassetOut,
            //     )

            //     const daiBalanceAfter = await IERC20__factory.connect(daiAddress, imusdHolder).balanceOf(imusdHolderAddress)
            //     const tokenBalanceDifference = daiBalanceAfter.sub(daiBalanceBefore)
            //     expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
            //     expect(daiBalanceAfter, "Token balance has increased").to.be.gt(daiBalanceBefore.add(minAmountOut))
            // })

            it("Upgrades the imBTC contract", async () => {
                const mbtcSaveImpl = await deployContract<SavingsContract>(
                    new SavingsContract__factory(deployer),
                    "mStable: mBTC Savings Contract",
                    [nexusAddress, mbtcAddress, unwrapper.address],
                )

                // expect(await delayedProxyAdmin.callStatic.nexus(), "nexus not match").to.eq(nexusAddress)
                // expect(await Nexus__factory.connect(nexusAddress, governor).callStatic.governor(), "governor not match").to.eq(
                //     governorAddress,
                // )

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
                const imbtcHolderAddress = "0x720366c95d26389471c52f854d43292157c03efd"
                const imbtcHolder = await impersonate(imbtcHolderAddress)

                const config = {
                    router: mbtcAddress,
                    input: mbtcAddress,
                    output: wbtcAddress,
                    amount: simpleToExactAmount(1, 18),
                }

                // Get estimated output via getUnwrapOutput
                const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.output)
                const amountOut = await unwrapper.getUnwrapOutput(isBassetOut, config.router, config.input, config.output, config.amount)
                expect(amountOut.toString().length).to.be.gte(8)
                const minAmountOut = amountOut.mul(98).div(1e2)

                // wbtc balance before
                const wbtcBalanceBefore = await IERC20__factory.connect(wbtcAddress, imbtcHolder).balanceOf(imbtcHolderAddress)
                const saveContractProxy = SavingsContract__factory.connect(imbtcAddress, imbtcHolder)

                await saveContractProxy.redeemAndUnwrap(
                    config.amount,
                    false,
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
        })
    })

    context("Stage 3", () => {
        describe("3.1 Directly", () => {
            it("Can call getIsBassetOut & it functions correctly", async () => {
                expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, daiAddress)).to.eq(true)
                expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, musdAddress)).to.eq(false)
                expect(await unwrapper.callStatic.getIsBassetOut(musdAddress, alusdAddress)).to.eq(false)
                expect(await unwrapper.callStatic.getIsBassetOut(mbtcAddress, wbtcAddress)).to.eq(true)
                expect(await unwrapper.callStatic.getIsBassetOut(mbtcAddress, mbtcAddress)).to.eq(false)
                expect(await unwrapper.callStatic.getIsBassetOut(mbtcAddress, hbtcAddress)).to.eq(false)
            })

            const validateAssetRedemption = async (
                config: {
                    router: string
                    input: string
                    output: string
                    amount: BigNumber
                },
                signer: Signer,
            ) => {
                // Get estimated output via getUnwrapOutput
                const signerAddress = await signer.getAddress()
                const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.output)

                const amountOut = await unwrapper.getUnwrapOutput(isBassetOut, config.router, config.input, config.output, config.amount)
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
                    output: "0x6b175474e89094c44da98b954eedeac495271d0f",
                    amount: simpleToExactAmount(1, 18),
                }
                const isBassetOut = await unwrapper.callStatic.getIsBassetOut(config.input, config.output)
                const output = await unwrapper.getUnwrapOutput(isBassetOut, config.router, config.input, config.output, config.amount)
                expect(output.toString()).to.be.length(19)
            })

            it("mUSD redeem to bAsset via unwrapAndSend", async () => {
                const config = {
                    router: musdAddress,
                    input: musdAddress,
                    output: daiAddress,
                    amount: simpleToExactAmount(1, 18),
                }
                await validateAssetRedemption(config, musdHolder)
            })

            it("mUSD redeem to fAsset via unwrapAndSend", async () => {
                const config = {
                    router: alusdFeederPool,
                    input: musdAddress,
                    output: alusdAddress,
                    amount: simpleToExactAmount(1, 18),
                }
                await validateAssetRedemption(config, musdHolder)
            })
        })

        describe("3.2 Via SavingsContracts", () => {})

        describe("3.3 Via Vaults", () => {
            const withdrawAndUnwrap = async (holderAddress: string, router: string, input: "musd" | "mbtc", outputAddress: string) => {
                const holder = await impersonate(holderAddress)
                const vaultAddress = input === "musd" ? imusdVaultAddress : imbtcVaultAddress
                const inputAddress = input === "musd" ? musdAddress : mbtcAddress
                const isBassetOut = await unwrapper.callStatic.getIsBassetOut(inputAddress, outputAddress)

                const config = {
                    router,
                    input: inputAddress,
                    output: outputAddress,
                    amount: simpleToExactAmount(input === "musd" ? 100 : 10, 18),
                }

                // Get estimated output via getUnwrapOutput
                const amountOut = await unwrapper.getUnwrapOutput(isBassetOut, config.router, config.input, config.output, config.amount)
                expect(amountOut.toString().length).to.be.gte(input === "musd" ? 18 : 9)
                console.log(amountOut.toString())
                const minAmountOut = amountOut.mul(98).div(100)

                const outContract = IERC20__factory.connect(config.output, holder)
                const tokenBalanceBefore = await outContract.balanceOf(holderAddress)

                // withdraw and unrap
                const saveVault = BoostedVault__factory.connect(vaultAddress, holder)
                await saveVault.withdrawAndUnwrap(
                    config.amount.mul(10),
                    minAmountOut,
                    config.output,
                    holderAddress,
                    config.router,
                    isBassetOut,
                )

                const tokenBalanceAfter = await outContract.balanceOf(holderAddress)
                const tokenBalanceDifference = tokenBalanceAfter.sub(tokenBalanceBefore)
                // expect(tokenBalanceDifference, "Withdrawn amount eq estimated amountOut").to.be.eq(amountOut)
                expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
            }
            // it("imUSD Vault redeem to bAsset", async () => {
            //     const vmusdHolderAddress = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"
            //     await withdrawAndUnwrap(vmusdHolderAddress, musdAddress, "musd", daiAddress)
            // })

            // it("imUSD Vault redeem to fAsset", async () => {
            //     const vmusdHolderAddress = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"
            //     await withdrawAndUnwrap(vmusdHolderAddress, alusdFeederPool, "musd", alusdAddress)
            // })

            it("imBTC Vault redeem to bAsset", async () => {
                const vmbtcHolderAddress = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
                await withdrawAndUnwrap(vmbtcHolderAddress, mbtcAddress, "mbtc", wbtcAddress)
            })

            it("imBTC Vault redeem to fAsset", async () => {
                const vhbtcmbtcHolderAddress = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
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
    })
})
