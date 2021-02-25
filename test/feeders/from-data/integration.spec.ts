/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN } from "@utils/math"
import { DEAD_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { ExposedFeederPool, ExposedFeederPool__factory, FeederLogic__factory, MockERC20, FeederManager__factory } from "types/generated"
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { feederData } from "@utils/validator-data"

const { full, sample } = feederData.integrationData

const config = {
    a: BN.from(80),
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(95, 16),
    },
}

const ratio = simpleToExactAmount(1, 8)
const tolerance = BN.from(10)

const cv = (n: number | string): BN => BN.from(BigInt(n).toString())
const getReserves = (data: any) =>
    [0, 1, 2, 3, 4, 5]
        .filter((i) => data[`reserve${i}`])
        .map((i) => ({
            ratio,
            vaultBalance: cv(data[`reserve${i}`]),
        }))

const chosenTestData = process.env.LONG_TESTS === "true" ? full : sample

describe("Feeder Validation - One basket many tests", () => {
    let feederPool: ExposedFeederPool
    let sa: StandardAccounts
    let recipient: string
    let bAssetAddresses: string[]
    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        recipient = await sa.default.address

        const mAssetDetails = await mAssetMachine.deployMasset(false, false, false)
        await mAssetMachine.seedWithWeightings(mAssetDetails, [25000000, 25000000, 25000000, 25000000])
        const bBtc = await mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", 18)
        const bAssets = [mAssetDetails.mAsset as MockERC20, bBtc]
        bAssetAddresses = bAssets.map((b) => b.address)
        const feederLogic = await new FeederLogic__factory(sa.default.signer).deploy()
        const manager = await new FeederManager__factory(sa.default.signer).deploy()
        const FeederFactory = (
            await ethers.getContractFactory("ExposedFeederPool", {
                libraries: {
                    FeederManager: manager.address,
                    FeederLogic: feederLogic.address,
                },
            })
        ).connect(sa.default.signer) as ExposedFeederPool__factory

        feederPool = (await FeederFactory.deploy(DEAD_ADDRESS, bAssets[0].address)) as ExposedFeederPool
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
            mAssetDetails.bAssets.map((b) => b.address),
            config,
        )
        await Promise.all(bAssets.map((b) => b.approve(feederPool.address, MAX_UINT256)))

        const reserves = getReserves(chosenTestData)

        await feederPool.mintMulti(
            bAssetAddresses,
            reserves.map((r) => r.vaultBalance),
            0,
            recipient,
        )
    })

    interface Data {
        totalSupply: BN
        vaultBalances: BN[]
        value: {
            price: BN
            k: BN
        }
    }
    const getData = async (_feederPool: ExposedFeederPool): Promise<Data> => ({
        totalSupply: await _feederPool.totalSupply(),
        vaultBalances: (await _feederPool.getBassets())[1].map((b) => b[1]),
        value: await _feederPool.getPrice(),
    })

    describe("Run all the data", () => {
        let dataBefore: Data
        let lastKDiff = BN.from(0)
        let count = 0

        for (const testData of chosenTestData.actions) {
            describe(`Action ${(count += 1)}`, () => {
                before(async () => {
                    dataBefore = await getData(feederPool)
                })
                switch (testData.type) {
                    case "mint":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when minting ${testData.inputQty.toString()} bAssets with index ${
                                testData.inputIndex
                            }`, async () => {
                                await expect(
                                    feederPool.mint(bAssetAddresses[testData.inputIndex], cv(testData.inputQty), 0, recipient),
                                ).to.be.revertedWith("Exceeds weight limits")

                                await expect(
                                    feederPool.getMintOutput(bAssetAddresses[testData.inputIndex], cv(testData.inputQty)),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`should deposit ${testData.inputQty.toString()} bAssets with index ${testData.inputIndex}`, async () => {
                                const expectedOutput = await feederPool.getMintOutput(
                                    bAssetAddresses[testData.inputIndex],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                await feederPool.mint(
                                    bAssetAddresses[testData.inputIndex],
                                    cv(testData.inputQty),
                                    cv(testData.expectedQty).sub(tolerance),
                                    recipient,
                                )

                                const dataMid = await getData(feederPool)
                                assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance)
                            })
                        }
                        break
                    case "mintMulti":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b))
                            if (testData.hardLimitError) {
                                it(`throws Max Weight error when minting ${qtys} bAssets with index ${testData.inputIndex}`, async () => {
                                    await expect(feederPool.mintMulti(bAssetAddresses, qtys, 0, recipient)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )

                                    await expect(feederPool.getMintMultiOutput(bAssetAddresses, qtys)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                })
                            } else {
                                it(`should mintMulti ${qtys} bAssets`, async () => {
                                    const expectedOutput = await feederPool.getMintMultiOutput(bAssetAddresses, qtys)
                                    assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                    await feederPool.mintMulti(bAssetAddresses, qtys, cv(testData.expectedQty).sub(tolerance), recipient)

                                    const dataMid = await getData(feederPool)
                                    assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance)
                                })
                            }
                        }
                        break
                    case "swap":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} ${testData.inputIndex} for ${
                                testData.outputIndex
                            }`, async () => {
                                await expect(
                                    feederPool.swap(
                                        bAssetAddresses[testData.inputIndex],
                                        bAssetAddresses[testData.outputIndex],
                                        cv(testData.inputQty),
                                        0,
                                        recipient,
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    feederPool.getSwapOutput(
                                        bAssetAddresses[testData.inputIndex],
                                        bAssetAddresses[testData.outputIndex],
                                        cv(testData.inputQty),
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`swaps ${testData.inputQty.toString()} ${testData.inputIndex} for ${testData.outputIndex}`, async () => {
                                const expectedOutput = await feederPool.getSwapOutput(
                                    bAssetAddresses[testData.inputIndex],
                                    bAssetAddresses[testData.outputIndex],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                await feederPool.swap(
                                    bAssetAddresses[testData.inputIndex],
                                    bAssetAddresses[testData.outputIndex],
                                    cv(testData.inputQty),
                                    cv(testData.expectedQty).sub(tolerance),
                                    recipient,
                                )
                            })
                        }
                        break
                    case "redeem":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await expect(
                                    feederPool.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    feederPool.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else if (testData.insufficientLiquidityError) {
                            it(`throws insufficient liquidity error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await expect(
                                    feederPool.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient),
                                ).to.be.revertedWith("VM Exception")
                                await expect(
                                    feederPool.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty),
                                ).to.be.revertedWith("VM Exception")
                            })
                        } else {
                            it(`redeem ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                const expectedOutput = await feederPool.getRedeemOutput(
                                    bAssetAddresses[testData.inputIndex],
                                    testData.inputQty,
                                )
                                assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                await feederPool.redeem(
                                    bAssetAddresses[testData.inputIndex],
                                    testData.inputQty,
                                    cv(testData.expectedQty).sub(tolerance),
                                    recipient,
                                )
                            })
                        }
                        break
                    case "redeemMasset":
                        {
                            const qtys = testData.expectedQtys.map((b) => cv(b).sub(5))
                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${testData.inputQty} mAsset`, async () => {
                                    await expect(
                                        feederPool.redeemProportionately(cv(testData.inputQty), qtys, recipient),
                                    ).to.be.revertedWith("VM Exception")
                                })
                            } else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await expect(
                                        feederPool.redeemProportionately(cv(testData.inputQty), qtys, recipient),
                                    ).to.be.revertedWith("Exceeds weight limits")
                                    throw new Error("invalid exception")
                                })
                            } else {
                                it(`redeem ${testData.inputQty} mAssets for proportionate bAssets`, async () => {
                                    await feederPool.redeemProportionately(cv(testData.inputQty), qtys, recipient)
                                })
                            }
                        }
                        break
                    case "redeemBassets":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b))

                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                                    await expect(feederPool.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith(
                                        "VM Exception",
                                    )
                                    await expect(feederPool.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith(
                                        "VM Exception",
                                    )
                                })
                            } else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await expect(feederPool.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                    await expect(feederPool.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                })
                            } else {
                                it(`redeem ${qtys} bAssets`, async () => {
                                    const expectedOutput = await feederPool.getRedeemExactBassetsOutput(bAssetAddresses, qtys)
                                    const testDataOutput = cv(testData.expectedQty).add(cv(testData.swapFee))
                                    assertBNClose(expectedOutput, testDataOutput, tolerance)

                                    await feederPool.redeemExactBassets(bAssetAddresses, qtys, testDataOutput.add(tolerance), recipient)

                                    const dataMid = await getData(feederPool)
                                    assertBNClose(dataBefore.totalSupply.sub(dataMid.totalSupply), expectedOutput, tolerance)
                                })
                            }
                        }
                        break
                    default:
                        throw Error("unknown action")
                }

                // TODO - add proper invariant checks
                it("holds invariant after action", async () => {
                    const dataEnd = await getData(feederPool)
                    // 1. Check resulting reserves
                    if (testData.reserves) {
                        dataEnd.vaultBalances.map((vb, i) => assertBNClose(vb, cv(testData.reserves[i]), BN.from(1000)))
                    }
                    // 2. Check that invariant holds: `totalSupply + surplus = k = invariant(reserves)`
                    //    After each action, this property should hold true, proving 100% that mint/swap/redeem hold,
                    //    and fees are being paid 100% accurately. This should show that the redeemBasset holds.
                    // assertBNSlightlyGT(dataEnd.value.k, dataEnd.totalSupply.mul(dataEnd.), BN.from(1000000000000), false, "K does not hold")
                    //    The dust collected should always increase in favour of the system
                    // const newKDiff = dataEnd.value.k.sub(dataEnd.totalSupply)
                    // const cachedLastDiff = lastKDiff
                    // lastKDiff = newKDiff
                    // if (testData.type !== "redeemMasset") {
                    //     expect(newKDiff, "Dust can only accumulate in favour of the system").gte(cachedLastDiff)
                    // } else if (newKDiff < cachedLastDiff) {
                    //     assertBNClose(newKDiff, cachedLastDiff, BN.from(200), "K dust accrues on redeemMasset")
                    // }

                    // // 3. Check swap fee accrual
                    // if (testData.swapFee) {
                    //     assertBNClose(
                    //         newKDiff,
                    //         cachedLastDiff.add(cv(testData.swapFee)),
                    //         2,
                    //         "Swap fees should accrue accurately after each action",
                    //     )
                    // }
                })
            })
        }
    })
})
