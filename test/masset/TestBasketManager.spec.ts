import * as t from "types/generated";
import * as chai from "chai";
import envSetup from "@utils/env_setup";

import { BN } from "@utils/tools";
import { Basset, BassetStatus, equalBassets, buildBasset } from "@utils/mstable-objects.ts";
import { createMultiple, simpleToExactAmount, percentToWeight } from "@utils/math";
import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { MassetMachine, StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { ZERO_ADDRESS, ZERO, ratioScale, fullScale } from "@utils/constants";
import { BassetIntegrationDetails } from "../../types";

import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { expect, assert } = envSetup.configure();

const BasketManager: t.BasketManagerContract = artifacts.require("BasketManager");
const MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const MockBasketManager: t.MockBasketManager3Contract = artifacts.require("MockBasketManager3");

contract("BasketManager", async (accounts) => {
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;

    const sa = new StandardAccounts(accounts);
    const grace = fullScale;
    const ctx: { module?: t.InitializablePausableModuleInstance } = {};
    const masset = sa.dummy1;
    const governance = sa.dummy2;
    const manager = sa.dummy3;
    const mockAaveIntegrationAddr = sa.dummy4;

    let integrationDetails: BassetIntegrationDetails;
    let basketManager: t.BasketManagerInstance;
    let nexus: t.MockNexusInstance;

    async function createMockBasketManger(): Promise<t.MockBasketManager3Instance> {
        const mockBasketManager = await MockBasketManager.new();
        await mockBasketManager.initialize(
            nexus.address,
            masset,
            grace,
            integrationDetails.aTokens.map((a) => a.bAsset),
            [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
            [percentToWeight(50), percentToWeight(50)],
            [false, false],
        );
        return mockBasketManager;
    }

    async function expectBassets(bAssetsArr: Array<Basset>, bitmap: BN, len: BN): Promise<void> {
        const bAssets = await basketManager.getBassets();
        equalBassets(bAssetsArr, bAssets[0]);
        expect(bitmap).to.bignumber.equal(bAssets[1]);
        expect(len).to.bignumber.equal(bAssets[2]);
    }

    async function createNewBasketManager(): Promise<t.BasketManagerInstance> {
        basketManager = await BasketManager.new();
        await basketManager.initialize(
            nexus.address,
            masset,
            grace,
            integrationDetails.aTokens.map((a) => a.bAsset),
            [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
            [percentToWeight(50), percentToWeight(50)],
            [false, false],
        );

        return basketManager;
    }

    before("", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;
        integrationDetails = await massetMachine.loadBassets();
        // await systemMachine.initialiseMocks(false, true);

        nexus = await MockNexus.new(sa.governor, governance, manager);
        // systemMachine.
        await createNewBasketManager();

        ctx.module = basketManager;
    });

    describe("behaviours:", async () => {
        describe("should behave like a Module", async () => {
            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
        });
    });

    describe("initialize()", () => {
        describe("should fail", () => {
            it("when already initialized", async () => {
                await expectRevert(
                    basketManager.initialize(
                        nexus.address,
                        masset,
                        grace,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "Contract instance has already been initialized",
                );
            });

            it("when nexus address is zero", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        ZERO_ADDRESS,
                        masset,
                        grace,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "Nexus address is zero",
                );
            });

            it("when mAsset address is zero", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        ZERO_ADDRESS,
                        grace,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "mAsset address is zero",
                );
            });

            it("when grace value is zero", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        masset,
                        ZERO,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "Must be within valid grace range",
                );
            });

            it("when grace value is greater than max limit", async () => {
                const bm = await BasketManager.new();
                const graceVal = new BN(10).pow(new BN(28));
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        masset,
                        graceVal,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "Must be within valid grace range",
                );
            });

            it("when bAsset array is empty", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        masset,
                        grace,
                        [],
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "Must initialise with some bAssets",
                );
            });

            it("when integration array is empty", async () => {
                const bm = await BasketManager.new();
                await expectRevert.assertion(
                    bm.initialize(
                        nexus.address,
                        masset,
                        grace,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                );
            });

            it("when weigh array is empty", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        masset,
                        grace,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [],
                        [false, false],
                    ),
                    "Must be matching bAsset arrays",
                );
            });

            it("when tokenFee array is empty", async () => {
                const bm = await BasketManager.new();
                await expectRevert.assertion(
                    bm.initialize(
                        nexus.address,
                        masset,
                        grace,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [],
                    ),
                );
            });

            it("when a bAsset already exist", async () => {
                const bm = await BasketManager.new();
                await expectRevert.unspecified(
                    bm.initialize(
                        nexus.address,
                        masset,
                        grace,
                        [sa.dummy1, sa.dummy1],
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                );
            });

            it("when array not have equal length", async () => {
                const bm = await BasketManager.new();
                await expectRevert.unspecified(
                    bm.initialize(
                        nexus.address,
                        masset,
                        grace,
                        [sa.dummy1, sa.dummy2, sa.dummy3],
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                );
            });
        });

        describe("with valid parameters", async () => {
            it("should have initialized with events", async () => {
                const bm = await BasketManager.new();
                const tx = await bm.initialize(
                    nexus.address,
                    masset,
                    grace,
                    integrationDetails.aTokens.map((a) => a.bAsset),
                    [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                    [percentToWeight(50), percentToWeight(50)],
                    [false, false],
                );

                expectEvent.inLogs(tx.logs, "BassetAdded", {
                    bAsset: integrationDetails.aTokens[0].bAsset,
                    integrator: mockAaveIntegrationAddr,
                });

                expectEvent.inLogs(tx.logs, "BassetAdded", {
                    bAsset: integrationDetails.aTokens[1].bAsset,
                    integrator: mockAaveIntegrationAddr,
                });

                // event GraceUpdated(uint256 newGrace)
                expectEvent.inLogs(tx.logs, "GraceUpdated", { newGrace: grace });

                // TODO test-helpers not supports `deep` array compare. Hence, need to test like below
                expectEvent.inLogs(tx.logs, "BasketWeightsUpdated");
                const basketWeightUpdatedEvent = tx.logs[3];
                expect(integrationDetails.aTokens.map((a) => a.bAsset)).to.deep.equal(
                    basketWeightUpdatedEvent.args[0],
                );
                basketWeightUpdatedEvent.args[1].map((a) =>
                    expect(a).to.bignumber.equal(percentToWeight(50)),
                );

                // should have initialized with nexus
                expect(nexus.address).to.equal(await basketManager.nexus());
                // should have mAsset address
                expect(masset).to.equal(await basketManager.mAsset());

                // should have default basket configurations
                const weight = new BN(10).pow(new BN(18)).div(new BN(2));
                const b1: Basset = await buildBasset(
                    integrationDetails.aTokens[0].bAsset,
                    BassetStatus.Normal,
                    false,
                    ratioScale,
                    weight,
                    ZERO,
                );

                const b2: Basset = await buildBasset(
                    integrationDetails.aTokens[1].bAsset,
                    BassetStatus.Normal,
                    false,
                    ratioScale,
                    weight,
                    ZERO,
                );
                await expectBassets([b1, b2], new BN(3), new BN(2));

                // should have all bAsset's integrations addresses
                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        const aTokenAddr = await basketManager.getBassetIntegrator(a.bAsset);
                        expect(mockAaveIntegrationAddr).to.equal(aTokenAddr);
                        return null;
                    }),
                );
            });
        });
    });

    describe("increaseVaultBalance()", async () => {
        it("should fail when called by other than masset contract", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAssetBefore = await basketManager.getBasset(a.bAsset);
                    await expectRevert(
                        basketManager.increaseVaultBalance(
                            index,
                            mockAaveIntegrationAddr,
                            new BN(100),
                            {
                                from: sa.other,
                            },
                        ),
                        "Must be called by mAsset",
                    );
                    const bAssetAfter = await basketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.vaultBalance).to.bignumber.equal(bAssetAfter.vaultBalance);
                    return null;
                }),
            );
        });

        it("should fail when basket is failed", async () => {
            const mockBasketManager: t.MockBasketManager3Instance = await createMockBasketManger();
            await mockBasketManager.failBasket();
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    await expectRevert(
                        mockBasketManager.increaseVaultBalance(
                            index,
                            mockAaveIntegrationAddr,
                            new BN(100),
                            {
                                from: masset,
                            },
                        ),
                        "Basket must be alive",
                    );
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.vaultBalance).to.bignumber.equal(bAssetAfter.vaultBalance);
                    return null;
                }),
            );
        });

        it("should fail when invalid basket index", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const invalidIndex = index + 5;
                    const bAssetBefore = await basketManager.getBasset(a.bAsset);
                    await expectRevert.assertion(
                        basketManager.increaseVaultBalance(
                            invalidIndex,
                            mockAaveIntegrationAddr,
                            new BN(100),
                            {
                                from: masset,
                            },
                        ),
                    );
                    const bAssetAfter = await basketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.vaultBalance).to.bignumber.equal(bAssetAfter.vaultBalance);
                    return null;
                }),
            );
        });

        it("should succeed for a valid bAsset", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAssetBefore: Basset = await basketManager.getBasset(a.bAsset);
                    await basketManager.increaseVaultBalance(
                        index,
                        mockAaveIntegrationAddr,
                        new BN(100),
                        {
                            from: masset,
                        },
                    );
                    const bAssetAfter = await basketManager.getBasset(a.bAsset);
                    expect(new BN(bAssetBefore.vaultBalance).add(new BN(100))).to.bignumber.equal(
                        bAssetAfter.vaultBalance,
                    );
                    return null;
                }),
            );
        });
    });

    describe("increaseVaultBalances()", () => {
        it("should fail when called by other than masset contract", async () => {
            const indexes: Array<number> = [0, 1];
            const integrators: Array<string> = [mockAaveIntegrationAddr, mockAaveIntegrationAddr];
            const increaseAmounts: Array<BN> = [new BN(100), new BN(100)];

            const bAssetBeforeArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetBeforeArr[index] = await basketManager.getBasset(a.bAsset);
                }),
            );

            await expectRevert(
                basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                    from: sa.other,
                }),
                "Must be called by mAsset",
            );

            const bAssetAfterArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetAfterArr[index] = await basketManager.getBasset(a.bAsset);

                    expect(bAssetBeforeArr[index].vaultBalance).to.bignumber.equal(
                        bAssetAfterArr[index].vaultBalance,
                    );
                }),
            );
        });

        it("should fail when basket is failed", async () => {
            const indexes: Array<number> = [0, 1];
            const integrators: Array<string> = [mockAaveIntegrationAddr, mockAaveIntegrationAddr];
            const increaseAmounts: Array<BN> = [new BN(100), new BN(100)];

            const mockBasketManager = await createMockBasketManger();

            const bAssetBeforeArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetBeforeArr[index] = await mockBasketManager.getBasset(a.bAsset);
                }),
            );

            await mockBasketManager.failBasket();

            await expectRevert(
                mockBasketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                    from: masset,
                }),
                "Basket must be alive",
            );

            const bAssetAfterArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetAfterArr[index] = await mockBasketManager.getBasset(a.bAsset);

                    expect(bAssetBeforeArr[index].vaultBalance).to.bignumber.equal(
                        bAssetAfterArr[index].vaultBalance,
                    );
                }),
            );
        });

        it("should fail when number of elements are more than number of bAssets");

        it("should fail when array length and len not match");

        it("should succeed and increase vault balance");
    });

    describe("decreaseVaultBalance()", async () => {
        it("should fail when called by other than masset contract", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAssetBefore = await basketManager.getBasset(a.bAsset);
                    await expectRevert(
                        basketManager.decreaseVaultBalance(
                            index,
                            mockAaveIntegrationAddr,
                            new BN(100),
                            {
                                from: sa.other,
                            },
                        ),
                        "Must be called by mAsset",
                    );
                    const bAssetAfter = await basketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.vaultBalance).to.bignumber.equal(bAssetAfter.vaultBalance);
                    return null;
                }),
            );
        });

        it("should fail when invalid basket index", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const invalidIndex = index + 5;
                    const bAssetBefore = await basketManager.getBasset(a.bAsset);
                    await expectRevert.assertion(
                        basketManager.decreaseVaultBalance(
                            invalidIndex,
                            mockAaveIntegrationAddr,
                            new BN(100),
                            {
                                from: masset,
                            },
                        ),
                    );
                    const bAssetAfter = await basketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.vaultBalance).to.bignumber.equal(bAssetAfter.vaultBalance);
                    return null;
                }),
            );
        });

        it("should succeed for a valid basket index", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAssetBefore: Basset = await basketManager.getBasset(a.bAsset);
                    await basketManager.increaseVaultBalance(
                        index,
                        mockAaveIntegrationAddr,
                        new BN(100),
                        {
                            from: masset,
                        },
                    );
                    const bAssetAfter: Basset = await basketManager.getBasset(a.bAsset);
                    expect(new BN(bAssetBefore.vaultBalance).add(new BN(100))).to.bignumber.equal(
                        bAssetAfter.vaultBalance,
                    );

                    await basketManager.decreaseVaultBalance(
                        index,
                        mockAaveIntegrationAddr,
                        new BN(10),
                        {
                            from: masset,
                        },
                    );
                    const bAssetAfterDecrease: Basset = await basketManager.getBasset(a.bAsset);
                    expect(new BN(bAssetAfter.vaultBalance).sub(new BN(10))).to.bignumber.equal(
                        bAssetAfterDecrease.vaultBalance,
                    );
                    return null;
                }),
            );
        });
    });

    describe("decreaseVaultBalances()", async () => {
        it("should fail when called by other than masset contract", async () => {
            const indexes: Array<number> = [0, 1];
            const integrators: Array<string> = [mockAaveIntegrationAddr, mockAaveIntegrationAddr];
            const increaseAmounts: Array<BN> = [new BN(100), new BN(100)];

            await basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                from: masset,
            });

            const bAssetBeforeArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetBeforeArr[index] = await basketManager.getBasset(a.bAsset);
                }),
            );

            await expectRevert(
                basketManager.decreaseVaultBalances(
                    indexes,
                    integrators,
                    increaseAmounts,
                    indexes.length,
                    { from: sa.other },
                ),
                "Must be called by mAsset",
            );

            const bAssetAfterArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetAfterArr[index] = await basketManager.getBasset(a.bAsset);

                    expect(bAssetBeforeArr[index].vaultBalance).to.bignumber.equal(
                        bAssetAfterArr[index].vaultBalance,
                    );
                }),
            );
        });

        it("should fail when basket is failed");

        it("should fail when number of elements are more than number of bAssets");

        it("should fail when array length and len not match");

        it("should succeed and decrease vault balance");
    });

    describe("collectInterest()", async () => {
        beforeEach("", async () => {
            // deposit to mock platforms
        });

        it("should have interested generated");
        it("todo...");
    });

    describe("addBasset()", async () => {
        describe("should fail", async () => {
            it("when bAsset address is zero");

            it("when integration address is zero");

            it("when bAsset already exist");

            it("when measurement multiple is out of range");
        });

        it("should calculate the ratio correctly");

        it("should allow for various measurementmultiples (under certain limit)");
    });

    describe("setBasketWeights()", async () => {
        it("should fail when empty array passed");

        it("should update the weights");

        it("should throw if some bassets are in an recollateralising state");
    });

    describe("setTransferFeesFlag()", async () => {
        beforeEach("", async () => {
            await createNewBasketManager();
        });
        it("should fail when not called by manager or governor", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    let bAsset: Basset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);

                    await expectRevert(
                        basketManager.setTransferFeesFlag(a.bAsset, true, { from: sa.other }),
                        "Must be manager or governor",
                    );

                    bAsset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);
                }),
            );
        });

        it("should fail when bAsset address is zero", async () => {
            await expectRevert(
                basketManager.setTransferFeesFlag(ZERO_ADDRESS, true, { from: sa.governor }),
                "bAsset does not exist",
            );
        });

        it("should fail when bAsset not exist", async () => {
            await expectRevert(
                basketManager.setTransferFeesFlag(sa.other, true, { from: manager }),
                "bAsset does not exist",
            );

            await expectRevert(
                basketManager.setTransferFeesFlag(sa.other, true, { from: sa.governor }),
                "bAsset does not exist",
            );
        });

        it("should succeed when called by manager for a valid bAsset", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    let bAsset: Basset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);

                    const tx = await basketManager.setTransferFeesFlag(a.bAsset, true, {
                        from: manager,
                    });
                    expectEvent.inLogs(tx.logs, "TransferFeeEnabled", {
                        bAsset: a.bAsset,
                        enabled: true,
                    });

                    bAsset = await basketManager.getBasset(a.bAsset);
                    expect(true).to.equal(bAsset.isTransferFeeCharged);
                }),
            );
        });

        it("should succeed when called by governor for a valid bAsset", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    let bAsset: Basset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);

                    const tx = await basketManager.setTransferFeesFlag(a.bAsset, true, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "TransferFeeEnabled", {
                        bAsset: a.bAsset,
                        enabled: true,
                    });

                    bAsset = await basketManager.getBasset(a.bAsset);
                    expect(true).to.equal(bAsset.isTransferFeeCharged);
                }),
            );
        });

        it("should allow enable fee for bAsset", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    let bAsset: Basset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);

                    const tx = await basketManager.setTransferFeesFlag(a.bAsset, true, {
                        from: manager,
                    });
                    expectEvent.inLogs(tx.logs, "TransferFeeEnabled", {
                        bAsset: a.bAsset,
                        enabled: true,
                    });

                    bAsset = await basketManager.getBasset(a.bAsset);
                    expect(true).to.equal(bAsset.isTransferFeeCharged);
                }),
            );
        });

        it("should allow disable fee for bAsset", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    let bAsset: Basset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);

                    let tx = await basketManager.setTransferFeesFlag(a.bAsset, true, {
                        from: manager,
                    });
                    expectEvent.inLogs(tx.logs, "TransferFeeEnabled", {
                        bAsset: a.bAsset,
                        enabled: true,
                    });

                    bAsset = await basketManager.getBasset(a.bAsset);
                    expect(true).to.equal(bAsset.isTransferFeeCharged);

                    tx = await basketManager.setTransferFeesFlag(a.bAsset, false, {
                        from: manager,
                    });
                    expectEvent.inLogs(tx.logs, "TransferFeeEnabled", {
                        bAsset: a.bAsset,
                        enabled: false,
                    });

                    bAsset = await basketManager.getBasset(a.bAsset);
                    expect(false).to.equal(bAsset.isTransferFeeCharged);
                }),
            );
        });
    });

    describe("setGrace()", async () => {
        it("should fail when not called by manager or governor");

        it("should fail when grace is out of range");

        it("should update when in range");
    });

    describe("removeBasset()", async () => {
        describe("should fail", async () => {
            it("when basket is not healthy");

            it("when not called by manager or governor");

            it("when bAsset address is zero");

            it("when bAsset address not exist");

            it("when bAsset targetWeight is non zero");

            it("when bAsset vault balance is non zero");

            it("when bAsset is not active");
        });

        it("should succeed when request is valid");
    });

    describe("getBasket()", async () => {
        it("get full basket with all parameters");
    });

    describe("prepareForgeBasset()", async () => {
        it("should fail when wrong token is passed");

        it("should return ForgeProps");
    });

    describe("prepareForgeBassets()", async () => {
        it("should fail when wrong bitmap is passed");

        it("should return ForgePropsMulti");
    });

    describe("getBassets()", async () => {
        it("should get all bAssets");
    });

    describe("getBasset()", async () => {
        it("should failed when token address is passed");

        it("should return bAsset");
    });

    describe("getBassetIntegrator()", async () => {
        it("should failed when token address is passed");

        it("should return integrator");
    });

    describe("getBitmapFor()", async () => {
        // Returns two bit set, as there are only two bAssets
        // const bitmap = await masset.getBitmapForAllBassets();
        // expect(bitmap, "wrong bitmap").bignumber.eq(new BN(127));
        // Result sets only first bit, as b1 is at first index in bAsset array
        // bitmap = await masset.getBitmapFor([b1.address]);
        // expect(bitmap).bignumber.eq(new BN(1));
        // Result sets only second bit, as b2 is at second index in bAsset array
        // bitmap = await masset.getBitmapFor([b2.address]);
        // expect(bitmap).bignumber.eq(new BN(2));
        // TODO add test for 0 items
        // TODO add test for 32 items
        // TODO add test for more than 32 items
    });

    describe("handlePegLoss()", async () => {
        it("should fail when not called by manager or governor");

        it("should fail when basket is not healthy");

        it("should fail when bAsset not exist");
    });

    describe("negateIsolation()", async () => {
        it("should fail when not called by manager or governor");
    });

    // =====

    it("Should convert bitmap to index array", async () => {
        // let indexes = await masset.convertBitmapToIndexArr(3, 2);
        // console.log(indexes);
        // TODO (3,3) will return indexes[0,1,0] which is wrong
        // TODO need to look for solution
        // shouldFail(await masset.convertBitmapToIndexArr(3, 3));
        // console.log(indexes);
    });
});
