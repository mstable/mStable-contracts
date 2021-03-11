/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN } from "@utils/math"
import { DEAD_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { ExposedInvariantValidator__factory, ExposedMasset } from "types/generated"
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import fullTestData from "@utils/validator-data/full/integrationData.json"
import sampleTestData from "@utils/validator-data/sample/integrationData.json"

const config = {
    a: BN.from(120),
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(75, 16),
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

const chosenTestData = process.env.LONG_TESTS === "true" ? fullTestData : sampleTestData

describe("Invariant Validator - One basket many tests", () => {
    let mAsset: ExposedMasset
    let sa: StandardAccounts
    let recipient: string
    let bAssetAddresses: string[]
    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        recipient = await sa.default.address

        const renBTC = await mAssetMachine.loadBassetProxy("Ren BTC", "renBTC", 18)
        const sBTC = await mAssetMachine.loadBassetProxy("Synthetix BTC", "sBTC", 18)
        const wBTC = await mAssetMachine.loadBassetProxy("Wrapped BTC", "wBTC", 18)
        const bAssets = [renBTC, sBTC, wBTC]
        bAssetAddresses = bAssets.map((b) => b.address)
        const forgeVal = await new ExposedInvariantValidator__factory(sa.default.signer).deploy()

        const ManagerFactory = await ethers.getContractFactory("Manager")
        const managerLib = await ManagerFactory.deploy()

        const MassetFactory = (
            await ethers.getContractFactory("ExposedMasset", {
                libraries: {
                    Manager: managerLib.address,
                },
            })
        ).connect(sa.default.signer)
        mAsset = (await MassetFactory.deploy(DEAD_ADDRESS)) as ExposedMasset
        await mAsset.initialize(
            "mStable Asset",
            "mAsset",
            forgeVal.address,
            bAssets.map((b) => ({
                addr: b.address,
                integrator: ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            })),
            config,
        )

        await Promise.all(bAssets.map((b) => b.approve(mAsset.address, MAX_UINT256)))

        const reserves = getReserves(chosenTestData)

        await mAsset.mintMulti(
            bAssetAddresses,
            reserves.map((r) => r.vaultBalance),
            0,
            recipient,
        )
    })

    interface Data {
        totalSupply: BN
        surplus: BN
        vaultBalances: BN[]
        k: BN
    }
    const getData = async (_mAsset: ExposedMasset): Promise<Data> => ({
        totalSupply: await _mAsset.totalSupply(),
        surplus: await _mAsset.surplus(),
        vaultBalances: (await _mAsset.getBassets())[1].map((b) => b[1]),
        k: await _mAsset.getK(),
    })

    describe("Run all the data", () => {
        let dataBefore: Data
        let lastKDiff = BN.from(0)
        let count = 0

        for (const testData of chosenTestData.actions) {
            describe(`Action ${(count += 1)}`, () => {
                before(async () => {
                    dataBefore = await getData(mAsset)
                })
                switch (testData.type) {
                    case "mint":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when minting ${testData.inputQty.toString()} bAssets with index ${
                                testData.inputIndex
                            }`, async () => {
                                await expect(
                                    mAsset.mint(bAssetAddresses[testData.inputIndex], cv(testData.inputQty), 0, recipient),
                                ).to.be.revertedWith("Exceeds weight limits")

                                await expect(
                                    mAsset.getMintOutput(bAssetAddresses[testData.inputIndex], cv(testData.inputQty)),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`should deposit ${testData.inputQty.toString()} bAssets with index ${testData.inputIndex}`, async () => {
                                const expectedOutput = await mAsset.getMintOutput(
                                    bAssetAddresses[testData.inputIndex],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                await mAsset.mint(
                                    bAssetAddresses[testData.inputIndex],
                                    cv(testData.inputQty),
                                    cv(testData.expectedQty).sub(tolerance),
                                    recipient,
                                )

                                const dataMid = await getData(mAsset)
                                assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance)
                            })
                        }
                        break
                    case "mintMulti":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b))
                            if (testData.hardLimitError) {
                                it(`throws Max Weight error when minting ${qtys} bAssets with index ${testData.inputIndex}`, async () => {
                                    await expect(mAsset.mintMulti(bAssetAddresses, qtys, 0, recipient)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )

                                    await expect(mAsset.getMintMultiOutput(bAssetAddresses, qtys)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                })
                            } else {
                                it(`should mintMulti ${qtys} bAssets`, async () => {
                                    const expectedOutput = await mAsset.getMintMultiOutput(bAssetAddresses, qtys)
                                    assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                    await mAsset.mintMulti(bAssetAddresses, qtys, cv(testData.expectedQty).sub(tolerance), recipient)

                                    const dataMid = await getData(mAsset)
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
                                    mAsset.swap(
                                        bAssetAddresses[testData.inputIndex],
                                        bAssetAddresses[testData.outputIndex],
                                        cv(testData.inputQty),
                                        0,
                                        recipient,
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    mAsset.getSwapOutput(
                                        bAssetAddresses[testData.inputIndex],
                                        bAssetAddresses[testData.outputIndex],
                                        cv(testData.inputQty),
                                    ),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else {
                            it(`swaps ${testData.inputQty.toString()} ${testData.inputIndex} for ${testData.outputIndex}`, async () => {
                                const expectedOutput = await mAsset.getSwapOutput(
                                    bAssetAddresses[testData.inputIndex],
                                    bAssetAddresses[testData.outputIndex],
                                    cv(testData.inputQty),
                                )
                                assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                await mAsset.swap(
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
                                    mAsset.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient),
                                ).to.be.revertedWith("Exceeds weight limits")
                                await expect(
                                    mAsset.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty),
                                ).to.be.revertedWith("Exceeds weight limits")
                            })
                        } else if (testData.insufficientLiquidityError) {
                            it(`throws insufficient liquidity error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await expect(
                                    mAsset.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient),
                                ).to.be.revertedWith("VM Exception")
                                await expect(
                                    mAsset.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty),
                                ).to.be.revertedWith("VM Exception")
                            })
                        } else {
                            it(`redeem ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                const expectedOutput = await mAsset.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty)
                                assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance)

                                await mAsset.redeem(
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
                                    await expect(mAsset.redeemMasset(cv(testData.inputQty), qtys, recipient)).to.be.revertedWith(
                                        "VM Exception",
                                    )
                                })
                            } else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await expect(mAsset.redeemMasset(cv(testData.inputQty), qtys, recipient)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                    throw new Error("invalid exception")
                                })
                            } else {
                                it(`redeem ${testData.inputQty} mAssets for proportionate bAssets`, async () => {
                                    await mAsset.redeemMasset(cv(testData.inputQty), qtys, recipient)
                                })
                            }
                        }
                        break
                    case "redeemBassets":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b))

                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                                    await expect(mAsset.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith(
                                        "VM Exception",
                                    )
                                    await expect(mAsset.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith(
                                        "VM Exception",
                                    )
                                })
                            } else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await expect(mAsset.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                    await expect(mAsset.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith(
                                        "Exceeds weight limits",
                                    )
                                })
                            } else {
                                it(`redeem ${qtys} bAssets`, async () => {
                                    const expectedOutput = await mAsset.getRedeemExactBassetsOutput(bAssetAddresses, qtys)
                                    const testDataOutput = cv(testData.expectedQty).add(cv(testData.swapFee))
                                    assertBNClose(expectedOutput, testDataOutput, tolerance)

                                    await mAsset.redeemExactBassets(bAssetAddresses, qtys, testDataOutput.add(tolerance), recipient)

                                    const dataMid = await getData(mAsset)
                                    assertBNClose(dataBefore.totalSupply.sub(dataMid.totalSupply), expectedOutput, tolerance)
                                })
                            }
                        }
                        break
                    default:
                        throw Error("unknown action")
                }

                it("holds invariant after action", async () => {
                    const dataEnd = await getData(mAsset)
                    // 1. Check resulting reserves
                    if (testData.reserves) {
                        dataEnd.vaultBalances.map((vb, i) => assertBNClose(vb, cv(testData.reserves[i]), BN.from(1000)))
                    }
                    // 2. Check swap fee accrual
                    if (testData.swapFee) {
                        assertBNClose(
                            dataEnd.surplus,
                            dataBefore.surplus.add(cv(testData.swapFee)),
                            2,
                            "Swap fees should accrue accurately after each action",
                        )
                    }
                    // 3. Check that invariant holds: `totalSupply + surplus = k = invariant(reserves)`
                    //    After each action, this property should hold true, proving 100% that mint/swap/redeem hold,
                    //    and fees are being paid 100% accurately. This should show that the redeemBasset holds.
                    assertBNSlightlyGT(
                        dataEnd.k,
                        dataEnd.surplus.add(dataEnd.totalSupply),
                        BN.from(1000000000000),
                        false,
                        "K does not hold",
                    )
                    //    The dust collected should always increase in favour of the system
                    const newKDiff = dataEnd.k.sub(dataEnd.surplus.add(dataEnd.totalSupply))
                    const cachedLastDiff = lastKDiff
                    lastKDiff = newKDiff
                    if (testData.type !== "redeemMasset") {
                        expect(newKDiff, "Dust can only accumulate in favour of the system").gte(cachedLastDiff)
                    } else if (newKDiff < cachedLastDiff) {
                        assertBNClose(newKDiff, cachedLastDiff, BN.from(200), "K dust accrues on redeemMasset")
                    }
                })
            })
        }
    })
})
