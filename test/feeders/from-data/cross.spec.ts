/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN } from "@utils/math"
import { DEAD_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import {
    ExposedFeederPool,
    ExposedFeederPool__factory,
    ExposedMasset,
    FeederLogic__factory,
    MockERC20,
    FeederManager__factory,
} from "types/generated"
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { crossData } from "@utils/validator-data"

const { integrationData } = crossData

const config = {
    a: BN.from(80),
    limits: {
        min: simpleToExactAmount(20, 16),
        max: simpleToExactAmount(80, 16),
    },
}

const ratio = simpleToExactAmount(1, 8)
const tolerance = BN.from(10)
const mAssetFees = { swap: simpleToExactAmount(4, 14), redeem: simpleToExactAmount(2, 14) }

const cv = (n: number | string): BN => BN.from(BigInt(n).toString())
const getMPReserves = (data: any) =>
    [0, 1, 2, 3, 4, 5]
        .filter((i) => data[`mpAssetReserve${i}`])
        .map((i) => ({
            ratio,
            vaultBalance: cv(data[`mpAssetReserve${i}`]),
        }))
const getFPReserves = (data: any) =>
    [data.feederPoolMAssetReserve, data.feederPoolFAssetReserve].map((r) => ({
        ratio,
        vaultBalance: cv(r),
    }))

const runLongTests = process.env.LONG_TESTS === "true"
const chosenTestData = runLongTests ? integrationData.full : integrationData.sample

interface Data {
    fp: {
        totalSupply: BN
        vaultBalances: BN[]
        value: {
            price: BN
            k: BN
        }
    }
    mAsset: {
        totalSupply: BN
        vaultBalances: BN[]
    }
}
const getData = async (_feederPool: ExposedFeederPool, _mAsset: ExposedMasset): Promise<Data> => ({
    fp: {
        totalSupply: (await _feederPool.totalSupply()).add((await _feederPool.data()).pendingFees),
        vaultBalances: (await _feederPool.getBassets())[1].map((b) => b[1]),
        value: await _feederPool.getPrice(),
    },
    mAsset: {
        totalSupply: (await _mAsset.totalSupply()).add(await _mAsset.surplus()),
        vaultBalances: (await _mAsset.getBassets())[1].map((b) => b[1]),
    },
})

describe("Cross swap - One basket many tests", () => {
    let feederPool: ExposedFeederPool
    let mAsset: ExposedMasset
    let sa: StandardAccounts
    let recipient: string
    let fpAssetAddresses: string[]
    let mpAssetAddresses: string[]
    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        recipient = await sa.default.address

        const mAssetDetails = await mAssetMachine.deployLite()

        await mAssetDetails.mAsset.connect(sa.governor.signer).setFees(mAssetFees.swap, mAssetFees.redeem)

        const fAsset = await mAssetMachine.loadBassetProxy("Feeder Asset", "fAST", 18)
        const bAssets = [mAssetDetails.mAsset as MockERC20, fAsset]
        fpAssetAddresses = bAssets.map((b) => b.address)
        mpAssetAddresses = mAssetDetails.bAssets.map((b) => b.address)
        mAsset = mAssetDetails.mAsset

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

        await mAssetMachine.seedWithWeightings(
            mAssetDetails,
            getMPReserves(chosenTestData).map((r) => r.vaultBalance),
            true,
        )

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
            mpAssetAddresses,
            config,
        )
        await Promise.all(bAssets.map((b) => b.approve(feederPool.address, MAX_UINT256)))
        await Promise.all(mAssetDetails.bAssets.map((b) => b.approve(feederPool.address, MAX_UINT256)))

        const reserves = getFPReserves(chosenTestData)

        await feederPool.mintMulti(
            fpAssetAddresses,
            reserves.map((r) => r.vaultBalance),
            0,
            recipient,
        )
    })

    describe("Run all the data", () => {
        let dataBefore: Data
        let count = 0

        for (const testData of chosenTestData.actions) {
            describe(`Action ${(count += 1)}`, () => {
                before(async () => {
                    dataBefore = await getData(feederPool, mAsset)
                })
                switch (testData.type) {
                    case "mint":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when minting ${testData.inputQty.toString()} mpAsset with index ${
                                testData.inputIndex
                            }`, async () => {
                                await expect(
                                    feederPool.mint(mpAssetAddresses[testData.inputIndex], cv(testData.inputQty), 0, recipient),
                                ).to.be.revertedWith("Exceeds weight limits")

                                await expect(
                                    feederPool.getMintOutput(mpAssetAddresses[testData.inputIndex], cv(testData.inputQty)),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`should deposit ${testData.inputQty.toString()} mpAsset with index ${testData.inputIndex}`, async () => {
                                const expectedOutput = await feederPool.getMintOutput(
                                    mpAssetAddresses[testData.inputIndex],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.outputQty), tolerance)

                                await feederPool.mint(
                                    mpAssetAddresses[testData.inputIndex],
                                    cv(testData.inputQty),
                                    cv(testData.outputQty).sub(tolerance),
                                    recipient,
                                )

                                const dataMid = await getData(feederPool, mAsset)
                                assertBNClose(dataMid.fp.totalSupply.sub(dataBefore.fp.totalSupply), expectedOutput, tolerance)
                            })
                        }
                        break
                    case "swap_mp_to_fp":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} ${
                                testData.inputIndex
                            } for fAsset`, async () => {
                                await expect(
                                    feederPool.swap(
                                        mpAssetAddresses[testData.inputIndex],
                                        fpAssetAddresses[1],
                                        cv(testData.inputQty),
                                        0,
                                        recipient,
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    feederPool.getSwapOutput(
                                        mpAssetAddresses[testData.inputIndex],
                                        fpAssetAddresses[1],
                                        cv(testData.inputQty),
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`swaps ${testData.inputQty.toString()} ${testData.inputIndex} for fAsset`, async () => {
                                const expectedOutput = await feederPool.getSwapOutput(
                                    mpAssetAddresses[testData.inputIndex],
                                    fpAssetAddresses[1],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.outputQty), tolerance)

                                await feederPool.swap(
                                    mpAssetAddresses[testData.inputIndex],
                                    fpAssetAddresses[1],
                                    cv(testData.inputQty),
                                    cv(testData.outputQty).sub(tolerance),
                                    recipient,
                                )
                            })
                        }
                        break
                    case "swap_fp_to_mp":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} fAsset for ${
                                testData.outputIndex
                            }`, async () => {
                                await expect(
                                    feederPool.swap(
                                        fpAssetAddresses[1],
                                        mpAssetAddresses[testData.outputIndex],
                                        cv(testData.inputQty),
                                        0,
                                        recipient,
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    feederPool.getSwapOutput(
                                        fpAssetAddresses[1],
                                        mpAssetAddresses[testData.outputIndex],
                                        cv(testData.inputQty),
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`swaps ${testData.inputQty.toString()} fAsset for ${testData.outputIndex}`, async () => {
                                const expectedOutput = await feederPool.getSwapOutput(
                                    fpAssetAddresses[1],
                                    mpAssetAddresses[testData.outputIndex],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.outputQty), tolerance)

                                await feederPool.swap(
                                    fpAssetAddresses[1],
                                    mpAssetAddresses[testData.outputIndex],
                                    cv(testData.inputQty),
                                    cv(testData.outputQty).sub(tolerance),
                                    recipient,
                                )
                            })
                        }
                        break
                    case "redeem":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when redeeming ${testData.inputQty} mAssets for mpAsset ${testData.outputIndex}`, async () => {
                                await expect(
                                    feederPool.redeem(mpAssetAddresses[testData.outputIndex], testData.inputQty, 0, recipient),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    feederPool.getRedeemOutput(mpAssetAddresses[testData.outputIndex], testData.inputQty),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else if (testData.insufficientLiquidityError) {
                            it(`throws insufficient liquidity error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.outputIndex}`, async () => {
                                await expect(
                                    feederPool.redeem(mpAssetAddresses[testData.outputIndex], testData.inputQty, 0, recipient),
                                ).to.be.revertedWith("VM Exception")
                                await expect(
                                    feederPool.getRedeemOutput(mpAssetAddresses[testData.outputIndex], testData.inputQty),
                                ).to.be.revertedWith("VM Exception")
                            })
                        } else {
                            it(`redeem ${testData.inputQty} mAssets for bAsset ${testData.outputIndex}`, async () => {
                                const expectedOutput = await feederPool.getRedeemOutput(
                                    mpAssetAddresses[testData.outputIndex],
                                    testData.inputQty,
                                )
                                assertBNClose(expectedOutput, cv(testData.outputQty), tolerance)

                                await feederPool.redeem(
                                    mpAssetAddresses[testData.outputIndex],
                                    testData.inputQty,
                                    cv(testData.outputQty).sub(tolerance),
                                    recipient,
                                )
                            })
                        }
                        break
                    default:
                        throw Error("unknown action")
                }

                it("holds invariant after action", async () => {
                    const dataEnd = await getData(feederPool, mAsset)
                    // 1. Check resulting reserves
                    if (testData.fpReserves) {
                        dataEnd.fp.vaultBalances.map((vb, i) => assertBNClose(vb, cv(testData.fpReserves[i]), BN.from(1000)))
                    }
                    if (testData.mpReserves) {
                        dataEnd.mAsset.vaultBalances.map((vb, i) => assertBNClose(vb, cv(testData.mpReserves[i]), BN.from(1000)))
                    }
                    // 2. Price always goes up
                    expect(dataEnd.fp.value.price, "fpToken price should always go up").gte(dataBefore.fp.value.price)
                    // 3. Supply checks out
                    if (testData.LPTokenSupply) {
                        assertBNClose(dataEnd.fp.totalSupply, cv(testData.LPTokenSupply), 100, "Total supply should check out")
                    }
                    if (testData.mAssetSupply) {
                        assertBNClose(dataEnd.mAsset.totalSupply, cv(testData.mAssetSupply), 100, "Total supply should check out")
                    }
                })
            })
        }
    })
})
