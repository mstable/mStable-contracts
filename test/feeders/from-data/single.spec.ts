import { assertBNClose } from "@utils/assertions"
import { DEAD_ADDRESS, fullScale, MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { feederData } from "@utils/validator-data"

import { expect } from "chai"
import { ethers } from "hardhat"
import {
    ExposedFeederLogic,
    ExposedFeederLogic__factory,
    FeederLogic__factory,
    FeederPool,
    MockERC20,
    FeederManager__factory,
    FeederPool__factory,
} from "types/generated"

const { mintData, mintMultiData, redeemData, redeemExactData, redeemProportionalData, swapData } = feederData

const config = {
    a: BN.from(30000),
    limits: {
        min: simpleToExactAmount(20, 16),
        max: simpleToExactAmount(80, 16),
    },
}
const swapFeeRate = simpleToExactAmount(8, 14)
const redemptionFeeRate = simpleToExactAmount(6, 14)

const ratio = simpleToExactAmount(1, 8)
const tolerance = 1

const cv = (n: number | string): BN => BN.from(BigInt(n).toString())
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getReserves = (data: any) =>
    [0, 1, 2, 3, 4]
        .filter((i) => data[`reserve${i}`])
        .map((i) => ({
            ratio,
            vaultBalance: cv(data[`reserve${i}`]),
        }))

const runLongTests = process.env.LONG_TESTS === "true"

describe("Feeder Validator - One basket one test", () => {
    let exposedFeeder: ExposedFeederLogic
    let sa: StandardAccounts

    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        const logic = await new FeederLogic__factory(sa.default.signer).deploy()
        const linkedAddress = {
            "contracts/feeders/FeederLogic.sol:FeederLogic": logic.address,
        }
        exposedFeeder = await new ExposedFeederLogic__factory(linkedAddress, sa.default.signer).deploy()
    })
    describe("Compute Mint", () => {
        let count = 0
        const testMintData = runLongTests ? mintData : mintData.slice(0, 2)
        testMintData.forEach((testData) => {
            const reserves = getReserves(testData)
            const localConfig = { ...config, supply: testData.LPTokenSupply }
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                testData.mints.forEach((testMint) => {
                    if (testMint.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when minting ${testMint.bAssetQty.toString()} bAssets with index ${
                            testMint.bAssetIndex
                        }`, async () => {
                            await expect(
                                exposedFeeder.computeMint(reserves, testMint.bAssetIndex, cv(testMint.bAssetQty), localConfig),
                            ).to.be.revertedWith("Exceeds weight limits")
                        })
                    } else {
                        it(`${(count += 1)} deposit ${testMint.bAssetQty.toString()} bAssets with index ${
                            testMint.bAssetIndex
                        }`, async () => {
                            const mAssetQty = await exposedFeeder.computeMint(
                                reserves,
                                testMint.bAssetIndex,
                                cv(testMint.bAssetQty),
                                localConfig,
                            )
                            expect(mAssetQty).eq(cv(testMint.expectedQty))
                        })
                    }
                })
            })
        })
    })
    describe("Compute Multi Mint", () => {
        let count = 0
        const testMultiMintData = runLongTests ? mintMultiData : mintMultiData.slice(0, 2)
        testMultiMintData.forEach((testData) => {
            const reserves = getReserves(testData)
            const localConfig = { ...config, supply: testData.LPTokenSupply }
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                testData.mints.forEach((testMint) => {
                    const qtys = testMint.bAssetQtys.map((b) => cv(b))
                    it(`${(count += 1)} deposit ${qtys} bAssets`, async () => {
                        const mAssetQty = await exposedFeeder.computeMintMulti(reserves, [0, 1], qtys, localConfig)
                        expect(mAssetQty).eq(cv(testMint.expectedQty))
                    })
                })
            })
        })
    })
    describe("Compute Swap", () => {
        let count = 0
        const testSwapData = runLongTests ? swapData : swapData.slice(0, 2)
        testSwapData.forEach((testData) => {
            const reserves = getReserves(testData)
            const localConfig = { ...config, supply: testData.LPTokenSupply }
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                testData.swaps.forEach((testSwap) => {
                    if (testSwap.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when swapping ${testSwap.inputQty.toString()} ${
                            testSwap.inputIndex
                        } for ${testSwap.outputIndex}`, async () => {
                            await expect(
                                exposedFeeder.computeSwap(
                                    reserves,
                                    testSwap.inputIndex,
                                    testSwap.outputIndex,
                                    cv(testSwap.inputQty),
                                    testSwap.outputIndex === 0 ? 0 : swapFeeRate,
                                    localConfig,
                                ),
                            ).to.be.revertedWith("Exceeds weight limits")
                        })
                    } else {
                        it(`${(count += 1)} swaps ${testSwap.inputQty.toString()} ${testSwap.inputIndex} for ${
                            testSwap.outputIndex
                        }`, async () => {
                            const result = await exposedFeeder.computeSwap(
                                reserves,
                                testSwap.inputIndex,
                                testSwap.outputIndex,
                                cv(testSwap.inputQty),
                                testSwap.outputIndex === 0 ? 0 : swapFeeRate,
                                localConfig,
                            )
                            assertBNClose(result.bAssetOutputQuantity, cv(testSwap.outputQty), tolerance)
                        })
                    }
                })
            })
        })
    })
    describe("Compute Redeem", () => {
        let count = 0
        const testRedeemData = runLongTests ? redeemData : redeemData.slice(0, 2)
        testRedeemData.forEach((testData) => {
            const reserves = getReserves(testData)
            const localConfig = { ...config, supply: testData.LPTokenSupply }
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                testData.redeems.forEach((testRedeem) => {
                    // Deduct swap fee before performing redemption
                    const netInput = cv(testRedeem.mAssetQty).mul(fullScale.sub(redemptionFeeRate)).div(fullScale)

                    if (testRedeem.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${testRedeem.mAssetQty} mAssets for bAsset ${
                            testRedeem.bAssetIndex
                        }`, async () => {
                            await expect(
                                exposedFeeder.computeRedeem(reserves, testRedeem.bAssetIndex, netInput, localConfig),
                            ).to.be.revertedWith("Exceeds weight limits")
                        })
                    } else {
                        it(`${(count += 1)} redeem ${testRedeem.mAssetQty} mAssets for bAsset ${testRedeem.bAssetIndex}`, async () => {
                            const bAssetQty = await exposedFeeder.computeRedeem(reserves, testRedeem.bAssetIndex, netInput, localConfig)
                            assertBNClose(bAssetQty, cv(testRedeem.outputQty), 2)
                        })
                    }
                })
            })
        })
    })
    describe("Compute Exact Redeem", () => {
        let count = 0
        const testRedeemExactData = runLongTests ? redeemExactData : redeemExactData.slice(0, 2)
        testRedeemExactData.forEach((testData) => {
            const reserves = getReserves(testData)
            const localConfig = { ...config, supply: testData.LPTokenSupply }
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                testData.redeems.forEach((testRedeem) => {
                    // Deduct swap fee after performing redemption
                    const applyFee = (m: BN): BN => m.mul(fullScale).div(fullScale.sub(redemptionFeeRate))
                    const qtys = testRedeem.bAssetQtys.map((b) => cv(b))

                    if (testRedeem.insufficientLiquidityError) {
                        it(`${(count += 1)} throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                            await expect(exposedFeeder.computeRedeemExact(reserves, [0, 1], qtys, localConfig)).to.be.revertedWith(
                                "VM Exception",
                            )
                        })
                    } else if (testRedeem.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                            await expect(exposedFeeder.computeRedeemExact(reserves, [0, 1], qtys, localConfig)).to.be.revertedWith(
                                "Exceeds weight limits",
                            )
                        })
                    } else {
                        it(`${(count += 1)} redeem ${qtys} bAssets`, async () => {
                            const mAssetQty = await exposedFeeder.computeRedeemExact(reserves, [0, 1], qtys, localConfig)
                            assertBNClose(applyFee(mAssetQty), cv(testRedeem.mAssetQty), tolerance)
                        })
                    }
                })
            })
        })
    })

    describe("Compute Redeem Masset", () => {
        let count = 0
        const testRedeemData = runLongTests ? redeemProportionalData : redeemProportionalData.slice(0, 2)
        testRedeemData.forEach((testData) => {
            const reserves = getReserves(testData)
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                let feederPool: FeederPool
                let recipient: string
                let bAssetAddresses: string[]
                let bAssets: MockERC20[]
                let mAssetBassets: MockERC20[]
                let feederFactory: FeederPool__factory
                before(async () => {
                    const accounts = await ethers.getSigners()
                    const mAssetMachine = await new MassetMachine().initAccounts(accounts)
                    sa = mAssetMachine.sa
                    recipient = await sa.default.address

                    const mAssetDetails = await mAssetMachine.deployMasset(false, false)
                    await mAssetMachine.seedWithWeightings(mAssetDetails, [25000000, 25000000, 25000000, 25000000])
                    mAssetBassets = mAssetDetails.bAssets
                    const bBtc = await mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", 18)
                    bAssets = [mAssetDetails.mAsset as MockERC20, bBtc]
                    bAssetAddresses = bAssets.map((b) => b.address)
                    const feederLogic = await new FeederLogic__factory(sa.default.signer).deploy()
                    const manager = await new FeederManager__factory(sa.default.signer).deploy()
                    feederFactory = (
                        await ethers.getContractFactory("FeederPool", {
                            libraries: {
                                FeederManager: manager.address,
                                FeederLogic: feederLogic.address,
                            },
                        })
                    ).connect(sa.default.signer) as FeederPool__factory

                    const linkedAddress = {
                        "contracts/feeders/FeederLogic.sol:FeederLogic": feederLogic.address,
                    }
                    exposedFeeder = await new ExposedFeederLogic__factory(linkedAddress, sa.default.signer).deploy()
                })

                beforeEach(async () => {
                    feederPool = (await feederFactory.deploy(DEAD_ADDRESS, bAssets[0].address, "0x0000000000000000000000000000000000000000")) as FeederPool
                    await feederPool.initialize(
                        "mStable mBTC/bBTC Feeder",
                        "bBTC fPool",
                        {
                            addr: bAssets[0].address,
                            integrator: ZERO_ADDRESS,
                            hasTxFee: false,
                            status: 0,
                        },
                        {
                            addr: bAssets[1].address,
                            integrator: ZERO_ADDRESS,
                            hasTxFee: false,
                            status: 0,
                        },
                        mAssetBassets.map((b) => b.address),
                        {
                            ...config,
                            a: config.a.div(100),
                        },
                    )
                    await Promise.all(bAssets.map((b) => b.approve(feederPool.address, MAX_UINT256)))
                    await feederPool.mintMulti(
                        bAssetAddresses,
                        reserves.map((r) => r.vaultBalance),
                        0,
                        recipient,
                    )
                })

                testData.redeems.forEach((testRedeem) => {
                    const qtys = testRedeem.bAssetQtys.map((b) => cv(b))
                    if ("insufficientLiquidityError" in testRedeem) {
                        it(`${(count += 1)} throws throw insufficient liquidity error when redeeming ${
                            testRedeem.mAssetQty
                        } mAsset`, async () => {
                            await expect(feederPool.redeemProportionately(cv(testRedeem.mAssetQty), qtys, recipient)).to.be.revertedWith(
                                "VM Exception",
                            )
                        })
                    } else if ("hardLimitError" in testRedeem) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                            await expect(feederPool.redeemProportionately(cv(testRedeem.mAssetQty), qtys, recipient)).to.be.revertedWith(
                                "Exceeds weight limits",
                            )
                            throw new Error("invalid exception")
                        })
                    } else {
                        it(`${(count += 1)} redeem ${testRedeem.mAssetQty} mAssets for proportionate bAssets`, async () => {
                            await feederPool.redeemProportionately(cv(testRedeem.mAssetQty), qtys, recipient)
                        })
                    }
                })
            })
        })
    })
})
