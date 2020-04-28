/* eslint-disable no-await-in-loop */
import * as t from "types/generated";
import envSetup from "@utils/env_setup";

import { BN } from "@utils/tools";
import {
    Basset,
    BassetStatus,
    equalBassets,
    buildBasset,
    equalBasset,
    calculateRatio,
} from "@utils/mstable-objects.ts";
import { percentToWeight } from "@utils/math";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { ZERO_ADDRESS, ZERO, ratioScale, fullScale } from "@utils/constants";
import { BassetIntegrationDetails } from "../../types";

import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "../shared/behaviours/PausableModule.behaviour";

const { expect } = envSetup.configure();

const BasketManager: t.BasketManagerContract = artifacts.require("BasketManager");
const AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");
const MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const MockBasketManager: t.MockBasketManager3Contract = artifacts.require("MockBasketManager3");
const MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const MockCompoundIntegration: t.MockCompoundIntegration2Contract = artifacts.require(
    "MockCompoundIntegration2",
);

contract("BasketManager", async (accounts) => {
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;

    const sa = new StandardAccounts(accounts);
    const ctx: { module?: t.InitializablePausableModuleInstance } = {};
    const masset = sa.dummy1;
    const governance = sa.dummy2;
    const manager = sa.dummy3;
    const mockAaveIntegrationAddr = sa.dummy4;

    let integrationDetails: BassetIntegrationDetails;
    let aaveIntegration: t.AaveIntegrationInstance;
    let basketManager: t.BasketManagerInstance;
    let nexus: t.MockNexusInstance;

    async function createMockBasketManger(): Promise<t.MockBasketManager3Instance> {
        const mockBasketManager = await MockBasketManager.new();
        await mockBasketManager.initialize(
            nexus.address,
            masset,
            integrationDetails.aTokens.map((a) => a.bAsset),
            [aaveIntegration.address, aaveIntegration.address],
            [percentToWeight(50), percentToWeight(50)],
            [false, false],
        );
        return mockBasketManager;
    }

    function createDefaultBassets(): Array<Basset> {
        const weight = new BN(10).pow(new BN(18)).div(new BN(2));
        const b1: Basset = buildBasset(
            integrationDetails.aTokens[0].bAsset,
            BassetStatus.Normal,
            false,
            ratioScale,
            weight,
            ZERO,
        );

        const b2: Basset = buildBasset(
            integrationDetails.aTokens[1].bAsset,
            BassetStatus.Normal,
            false,
            ratioScale,
            weight,
            ZERO,
        );
        return [b1, b2];
    }

    async function expectBassets(bAssetsArr: Array<Basset>, len: BN): Promise<void> {
        const [receivedBassets, receivedLen] = await basketManager.getBassets();
        equalBassets(bAssetsArr, receivedBassets);
        expect(len).to.bignumber.equal(receivedLen);
    }

    async function createNewBasketManager(): Promise<t.BasketManagerInstance> {
        basketManager = await BasketManager.new();
        await basketManager.initialize(
            nexus.address,
            masset,
            integrationDetails.aTokens.map((a) => a.bAsset),
            [aaveIntegration.address, aaveIntegration.address],
            [percentToWeight(50), percentToWeight(50)],
            [false, false],
        );

        return basketManager;
    }

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;
        integrationDetails = await massetMachine.loadBassets();

        nexus = await MockNexus.new(sa.governor, governance, manager);

        aaveIntegration = await AaveIntegration.new();
        await aaveIntegration.initialize(
            nexus.address,
            [masset, governance],
            integrationDetails.aavePlatformAddress,
            integrationDetails.aTokens.map((a) => a.bAsset),
            integrationDetails.aTokens.map((a) => a.aToken),
        );
        await createNewBasketManager();

        ctx.module = basketManager;
    });

    describe("behaviours:", async () => {
        describe("should behave like a Module", async () => {
            beforeEach(async () => {
                await createNewBasketManager();
                ctx.module = basketManager;
            });
            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
            shouldBehaveLikePausableModule(ctx as Required<typeof ctx>, sa);
        });
    });

    describe("initialize()", () => {
        describe("should fail", () => {
            it("when already initialized", async () => {
                await expectRevert(
                    basketManager.initialize(
                        nexus.address,
                        masset,
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
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [mockAaveIntegrationAddr, mockAaveIntegrationAddr],
                        [percentToWeight(50), percentToWeight(50)],
                        [false, false],
                    ),
                    "mAsset address is zero",
                );
            });

            it("when bAsset array is empty", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        masset,
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

                // test-helpers not supports `deep` array compare. Hence, need to test like below
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
                await expectBassets(createDefaultBassets(), new BN(2));

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

        it("should succeed and increase vault balance", async () => {
            const indexes: Array<number> = [0, 1];
            const integrators: Array<string> = [mockAaveIntegrationAddr, mockAaveIntegrationAddr];
            const increaseAmounts: Array<BN> = [new BN(100), new BN(100)];

            const bAssetBeforeArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetBeforeArr[index] = await basketManager.getBasset(a.bAsset);
                }),
            );

            await basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                from: masset,
            });

            const bAssetAfterArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetAfterArr[index] = await basketManager.getBasset(a.bAsset);

                    expect(
                        new BN(bAssetBeforeArr[index].vaultBalance).add(new BN(100)),
                    ).to.bignumber.equal(bAssetAfterArr[index].vaultBalance);
                }),
            );
        });
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
            const decreaseAmounts: Array<BN> = [new BN(100), new BN(100)];

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
                basketManager.decreaseVaultBalances(indexes, integrators, decreaseAmounts, {
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

        it("should fail when invalid bAsset index", async () => {
            const indexes: Array<number> = [0, 1];
            const invalidIndexes: Array<number> = [5, 6];
            const integrators: Array<string> = [mockAaveIntegrationAddr, mockAaveIntegrationAddr];
            const increaseAmounts: Array<BN> = [new BN(100), new BN(100)];
            const decreaseAmounts: Array<BN> = [new BN(100), new BN(100)];

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
                basketManager.decreaseVaultBalances(invalidIndexes, integrators, decreaseAmounts, {
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

        it("should succeed and decrease vault balance", async () => {
            const indexes: Array<number> = [0, 1];
            const integrators: Array<string> = [mockAaveIntegrationAddr, mockAaveIntegrationAddr];
            const increaseAmounts: Array<BN> = [new BN(100), new BN(100)];
            const decreaseAmounts: Array<BN> = [new BN(100), new BN(100)];

            await basketManager.decreaseVaultBalances(indexes, integrators, increaseAmounts, {
                from: masset,
            });

            const bAssetBeforeArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetBeforeArr[index] = await basketManager.getBasset(a.bAsset);
                }),
            );

            await basketManager.decreaseVaultBalances(indexes, integrators, decreaseAmounts, {
                from: masset,
            });

            const bAssetAfterArr: Array<Basset> = new Array(indexes.length);
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    bAssetAfterArr[index] = await basketManager.getBasset(a.bAsset);

                    expect(
                        new BN(bAssetBeforeArr[index].vaultBalance).sub(new BN(100)),
                    ).to.bignumber.equal(bAssetAfterArr[index].vaultBalance);
                }),
            );
        });
    });

    describe("collectInterest()", async () => {
        let mockCompound: t.MockCompoundIntegration2Instance;

        beforeEach(async () => {
            // deposit to mock platforms
            mockCompound = await MockCompoundIntegration.new();
            basketManager = await BasketManager.new();
            await basketManager.initialize(
                nexus.address,
                masset,
                integrationDetails.aTokens.map((a) => a.bAsset),
                [mockCompound.address, mockCompound.address],
                [percentToWeight(50), percentToWeight(50)],
                [false, false],
            );
        });

        describe("should fail", async () => {
            it("when called from other than Masset", async () => {
                await expectRevert(
                    basketManager.collectInterest({ from: sa.other }),
                    "Must be called by mAsset",
                );
            });

            it("when contract is Pasued", async () => {
                await basketManager.pause({ from: sa.governor });
                await expectRevert(
                    basketManager.collectInterest({ from: masset }),
                    "Pausable: paused",
                );
            });
        });

        it("should have interest generated", async () => {
            const existingVaultBal = new BN(10).pow(new BN(17));
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    await basketManager.increaseVaultBalance(
                        index,
                        mockCompound.address,
                        existingVaultBal,
                        { from: masset },
                    );

                    const bAsset = await basketManager.getBasset(a.bAsset);
                    expect(existingVaultBal).to.bignumber.equal(bAsset.vaultBalance);
                }),
            );

            const platformBalance = new BN(10).pow(new BN(18));
            await mockCompound.setCustomBalance(platformBalance);

            await basketManager.collectInterest({ from: masset });

            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAsset = await basketManager.getBasset(a.bAsset);
                    expect(platformBalance).to.bignumber.equal(bAsset.vaultBalance);
                }),
            );
        });

        it("when no interest generated", async () => {
            const existingValutBal = new BN(10).pow(new BN(18));
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    await basketManager.increaseVaultBalance(
                        index,
                        mockCompound.address,
                        existingValutBal,
                        { from: masset },
                    );

                    const bAsset = await basketManager.getBasset(a.bAsset);
                    expect(existingValutBal).to.bignumber.equal(bAsset.vaultBalance);
                }),
            );

            const platformBalance = new BN(10).pow(new BN(18));
            await mockCompound.setCustomBalance(platformBalance);

            await basketManager.collectInterest({ from: masset });

            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAsset = await basketManager.getBasset(a.bAsset);
                    expect(existingValutBal).to.bignumber.equal(bAsset.vaultBalance);
                }),
            );
        });
    });

    describe("addBasset()", async () => {
        let mockERC20: t.MockERC20Instance;
        beforeEach(async () => {
            await createNewBasketManager();
            mockERC20 = await MockERC20.new("Mock", "MKT", 18, sa.default, new BN(10000));
        });

        describe("should fail", async () => {
            it("when called by other than governor", async () => {
                await expectRevert(
                    basketManager.addBasset(mockERC20.address, mockAaveIntegrationAddr, false, {
                        from: sa.other,
                    }),
                    "Only governor can execute",
                );
            });

            it("when basket is failed", async () => {
                const mockBasketManager = await createMockBasketManger();
                await mockBasketManager.failBasket();
                await expectRevert(
                    mockBasketManager.addBasset(mockERC20.address, mockAaveIntegrationAddr, false, {
                        from: sa.governor,
                    }),
                    "Basket must be alive",
                );
            });

            it("when bAsset address is zero", async () => {
                await expectRevert(
                    basketManager.addBasset(ZERO_ADDRESS, mockAaveIntegrationAddr, false, {
                        from: sa.governor,
                    }),
                    "Asset address must be valid",
                );
            });

            it("when integration address is zero", async () => {
                await expectRevert(
                    basketManager.addBasset(mockERC20.address, ZERO_ADDRESS, false, {
                        from: sa.governor,
                    }),
                    "Integration address must be valid",
                );
            });

            it("when bAsset already exist", async () => {
                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        await expectRevert(
                            basketManager.addBasset(a.bAsset, mockAaveIntegrationAddr, false, {
                                from: sa.governor,
                            }),
                            "bAsset already exists in Basket",
                        );
                    }),
                );
            });

            it("when max bAssets reached", async () => {
                const mockERC20s: Array<t.MockERC20Instance> = new Array(13);
                for (let index = 0; index < 14; index += 1) {
                    const mock = await MockERC20.new("Mock", "MKT", 18, sa.default, new BN(10000));
                    mockERC20s.push(mock);
                }

                let bAssets = await basketManager.getBassets();
                const lengthBefore = bAssets[0].length;
                expect(2).to.equal(lengthBefore);

                await Promise.all(
                    mockERC20s.map(async (a) => {
                        await basketManager.addBasset(a.address, mockAaveIntegrationAddr, false, {
                            from: sa.governor,
                        });
                    }),
                );

                bAssets = await basketManager.getBassets();
                const lengthAfter = bAssets[0].length;
                expect(16).to.equal(lengthAfter);

                await expectRevert(
                    basketManager.addBasset(mockERC20.address, mockAaveIntegrationAddr, false, {
                        from: sa.governor,
                    }),
                    "Max bAssets in Basket",
                );
            });
        });

        it("should add a new bAsset with 18 decimals", async () => {
            let bAssets = await basketManager.getBassets();
            const lengthBefore = bAssets[0].length;
            expect(2).to.equal(lengthBefore);

            const tx = await basketManager.addBasset(
                mockERC20.address,
                mockAaveIntegrationAddr,
                false,
                {
                    from: sa.governor,
                },
            );
            expectEvent.inLogs(tx.logs, "BassetAdded", {
                bAsset: mockERC20.address,
                integrator: mockAaveIntegrationAddr,
            });

            bAssets = await basketManager.getBassets();
            const lengthAfter = bAssets[0].length;
            expect(3).to.equal(lengthAfter);

            const bAsset = await basketManager.getBasset(mockERC20.address);
            const ratio = calculateRatio(ratioScale, await mockERC20.decimals());
            const expectedBasset = buildBasset(
                mockERC20.address,
                BassetStatus.Normal,
                false,
                ratio,
                new BN(0),
                new BN(0),
            );
            equalBasset(expectedBasset, bAsset);
            const integrator = await basketManager.getBassetIntegrator(mockERC20.address);
            expect(integrator).eq(mockAaveIntegrationAddr);
        });

        it("should add a new bAsset with 10 decimals", async () => {
            mockERC20 = await MockERC20.new("Mock", "MKT", 10, sa.default, new BN(10000));
            let bAssets = await basketManager.getBassets();
            const lengthBefore = bAssets[0].length;
            expect(2).to.equal(lengthBefore);

            const tx = await basketManager.addBasset(
                mockERC20.address,
                mockAaveIntegrationAddr,
                false,
                {
                    from: sa.governor,
                },
            );
            expectEvent.inLogs(tx.logs, "BassetAdded", {
                bAsset: mockERC20.address,
                integrator: mockAaveIntegrationAddr,
            });

            bAssets = await basketManager.getBassets();
            const lengthAfter = bAssets[0].length;
            expect(3).to.equal(lengthAfter);

            const bAsset = await basketManager.getBasset(mockERC20.address);
            const ratio = calculateRatio(ratioScale, await mockERC20.decimals());
            const expectedBasset = buildBasset(
                mockERC20.address,
                BassetStatus.Normal,
                false,
                ratio,
                new BN(0),
                new BN(0),
            );
            equalBasset(expectedBasset, bAsset);
            const integrator = await basketManager.getBassetIntegrator(mockERC20.address);
            expect(integrator).eq(mockAaveIntegrationAddr);
        });
    });

    describe("setBasketWeights()", async () => {
        let mockBasketManager: t.MockBasketManager3Instance;
        beforeEach(async () => {
            mockBasketManager = await createMockBasketManger();
        });

        describe("should fail", async () => {
            it("when not called by governor", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(60), percentToWeight(40)],
                        { from: sa.other },
                    ),
                    "Only governor can execute",
                );
            });

            it("should fail when empty array passed", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights([], [], { from: sa.governor }),
                    "Empty bAssets array passed",
                );
            });

            it("when basket is not healthy", async () => {
                await mockBasketManager.failBasket();

                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(60), percentToWeight(40)],
                        { from: sa.governor },
                    ),
                    "Basket must be alive",
                );
            });

            it("when array length not matched", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(100)],
                        { from: sa.governor },
                    ),
                    "Must be matching bAsset arrays",
                );
            });

            it("when bAsset does not exist", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights([sa.other], [percentToWeight(100)], {
                        from: sa.governor,
                    }),
                    "bAsset must exist",
                );
            });

            it("when bAssetWeight is greater than 1e18", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(101), percentToWeight(100)],
                        { from: sa.governor },
                    ),
                    "Asset weight must be <= 1e18",
                );
            });

            it("when bAsset is not active", async () => {
                const bAssetBelowPeg = integrationDetails.aTokens[0].bAsset;
                await mockBasketManager.setBassetStatus(
                    bAssetBelowPeg,
                    BassetStatus.BrokenBelowPeg,
                );

                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(60), percentToWeight(40)],
                        { from: sa.governor },
                    ),
                    "Affected bAssets must be static",
                );
            });

            it("when total weight is not valid", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(60), percentToWeight(50)],
                        { from: sa.governor },
                    ),
                    "Basket weight must be = 1e18",
                );
            });
        });

        it("should update the weights", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAsset: Basset = await mockBasketManager.getBasset(a.bAsset);
                    expect(percentToWeight(50)).to.bignumber.equal(bAsset.maxWeight);
                }),
            );

            await mockBasketManager.setBasketWeights(
                integrationDetails.aTokens.map((a) => a.bAsset),
                [percentToWeight(60), percentToWeight(40)],
                { from: sa.governor },
            );

            const expectedWeight: Array<BN> = [percentToWeight(60), percentToWeight(40)];
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAsset: Basset = await mockBasketManager.getBasset(a.bAsset);
                    expect(expectedWeight[index]).to.bignumber.equal(bAsset.maxWeight);
                }),
            );
        });
        it("should update the weights even with affected bAsset", async () => {
            const { aTokens } = integrationDetails;
            await Promise.all(
                aTokens.map(async (a) => {
                    const bAsset: Basset = await mockBasketManager.getBasset(a.bAsset);
                    expect(percentToWeight(50)).to.bignumber.equal(bAsset.maxWeight);
                }),
            );
            const mockERC20 = await MockERC20.new("Mock", "MKT", 18, sa.default, new BN(10000));
            await mockBasketManager.addBasset(mockERC20.address, mockAaveIntegrationAddr, false, {
                from: sa.governor,
            });
            await mockBasketManager.setBassetStatus(aTokens[1].bAsset, BassetStatus.BrokenBelowPeg);

            await mockBasketManager.setBasketWeights(
                [...aTokens.map((a) => a.bAsset), mockERC20.address],
                [percentToWeight(30), percentToWeight(50), percentToWeight(20)],
                { from: sa.governor },
            );

            const expectedWeight: Array<BN> = [
                percentToWeight(30),
                percentToWeight(50),
                percentToWeight(20),
            ];
            const [bassets] = await mockBasketManager.getBassets();
            await Promise.all(
                bassets.map(async (b, index) => {
                    expect(expectedWeight[index]).to.bignumber.equal(new BN(b.maxWeight));
                }),
            );
        });
    });

    describe("setTransferFeesFlag()", async () => {
        beforeEach(async () => {
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
                basketManager.setTransferFeesFlag(ZERO_ADDRESS, true, { from: manager }),
                "bAsset does not exist",
            );

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

    describe("removeBasset()", async () => {
        beforeEach(async () => {
            await createNewBasketManager();
        });

        describe("should fail", async () => {
            it("when basket is not healthy", async () => {
                const mockBasketManager = await createMockBasketManger();
                mockBasketManager.failBasket();

                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        const lengthBefore = (await mockBasketManager.getBassets())[0].length;

                        await expectRevert(
                            mockBasketManager.removeBasset(a.bAsset, { from: manager }),
                            "Basket must be alive",
                        );

                        const lengthAfter = (await mockBasketManager.getBassets())[0].length;
                        expect(lengthBefore).to.equal(lengthAfter);
                    }),
                );
            });

            it("when not called by manager or governor", async () => {
                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        const lengthBefore = (await basketManager.getBassets())[0].length;

                        await expectRevert(
                            basketManager.removeBasset(a.bAsset, { from: sa.other }),
                            "Must be manager or governor",
                        );

                        const lengthAfter = (await basketManager.getBassets())[0].length;
                        expect(lengthBefore).to.equal(lengthAfter);
                    }),
                );
            });

            it("when bAsset address is zero", async () => {
                const lengthBefore = (await basketManager.getBassets())[0].length;

                await expectRevert(
                    basketManager.removeBasset(ZERO_ADDRESS, { from: manager }),
                    "bAsset does not exist",
                );

                const lengthAfter = (await basketManager.getBassets())[0].length;
                expect(lengthBefore).to.equal(lengthAfter);
            });

            it("when bAsset address not exist", async () => {
                const lengthBefore = (await basketManager.getBassets())[0].length;

                await expectRevert(
                    basketManager.removeBasset(sa.other, { from: manager }),
                    "bAsset does not exist",
                );

                const lengthAfter = (await basketManager.getBassets())[0].length;
                expect(lengthBefore).to.equal(lengthAfter);
            });

            it("when bAsset maxWeight is non zero (by governor)", async () => {
                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        const lengthBefore = (await basketManager.getBassets())[0].length;

                        await expectRevert(
                            basketManager.removeBasset(a.bAsset, { from: sa.governor }),
                            "bAsset must have a target weight of 0",
                        );

                        const lengthAfter = (await basketManager.getBassets())[0].length;
                        expect(lengthBefore).to.equal(lengthAfter);
                    }),
                );
            });

            it("when bAsset vault balance is non zero (by governor)", async () => {
                const bAssetToRemove = integrationDetails.aTokens[0].bAsset;

                const lengthBefore = (await basketManager.getBassets())[0].length;

                await basketManager.increaseVaultBalance(0, mockAaveIntegrationAddr, new BN(100), {
                    from: masset,
                });

                const bAssets = integrationDetails.aTokens.map((a) => a.bAsset);
                const newWeights = [percentToWeight(0), percentToWeight(100)];
                await basketManager.setBasketWeights(bAssets, newWeights, { from: sa.governor });

                await expectRevert(
                    basketManager.removeBasset(bAssetToRemove, { from: sa.governor }),
                    "bAsset vault must be empty",
                );

                const lengthAfter = (await basketManager.getBassets())[0].length;
                expect(lengthBefore).to.equal(lengthAfter);
            });

            it("when bAsset status is not active (by governor)", async () => {
                const mockBasketManager = await createMockBasketManger();
                const bAssetToRemove = integrationDetails.aTokens[0].bAsset;

                const lengthBefore = (await mockBasketManager.getBassets())[0].length;

                const bAssets = integrationDetails.aTokens.map((a) => a.bAsset);
                const newWeights = [percentToWeight(0), percentToWeight(100)];
                await mockBasketManager.setBasketWeights(bAssets, newWeights, {
                    from: sa.governor,
                });

                await mockBasketManager.setBassetStatus(bAssetToRemove, BassetStatus.Liquidating);

                await expectRevert(
                    mockBasketManager.removeBasset(bAssetToRemove, { from: sa.governor }),
                    "bAsset must be active",
                );

                const lengthAfter = (await mockBasketManager.getBassets())[0].length;
                expect(lengthBefore).to.equal(lengthAfter);
            });
        });

        it("should succeed when request is valid (by manager)", async () => {
            const mockBasketManager = await createMockBasketManger();
            const bAssetToRemove = integrationDetails.aTokens[0].bAsset;
            const unMovedBasset = integrationDetails.aTokens[1].bAsset;

            const lengthBefore = (await mockBasketManager.getBassets())[0].length;

            const bAssets = integrationDetails.aTokens.map((a) => a.bAsset);
            const newWeights = [percentToWeight(0), percentToWeight(100)];
            await mockBasketManager.setBasketWeights(bAssets, newWeights, {
                from: sa.governor,
            });
            const bAssetBefore = await mockBasketManager.getBasset(unMovedBasset);
            const bAssetIntegratorBefore = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );

            const tx = await mockBasketManager.removeBasset(bAssetToRemove, { from: manager });
            expectEvent.inLogs(tx.logs, "BassetRemoved", { bAsset: bAssetToRemove });

            // Basket should still behave as normal, getting the desired details and integrator
            const bAssetAfter = await mockBasketManager.getBasset(unMovedBasset);
            equalBasset(bAssetBefore, bAssetAfter);
            const bAssetIntegratorAfter = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );
            await expectRevert(mockBasketManager.integrations(1), "invalid opcode");

            expect(bAssetIntegratorBefore).eq(bAssetIntegratorAfter);
            const lengthAfter = (await mockBasketManager.getBassets())[0].length;
            expect(lengthBefore - 1).to.equal(lengthAfter);

            await expectRevert(mockBasketManager.getBasset(bAssetToRemove), "bAsset must exist");
        });

        it("should succeed when request is valid (by governor)", async () => {
            const mockBasketManager = await createMockBasketManger();
            const bAssetToRemove = integrationDetails.aTokens[1].bAsset;
            const unMovedBasset = integrationDetails.aTokens[0].bAsset;

            const lengthBefore = (await mockBasketManager.getBassets())[0].length;

            const bAssets = integrationDetails.aTokens.map((a) => a.bAsset);
            const newWeights = [percentToWeight(100), percentToWeight(0)];
            await mockBasketManager.setBasketWeights(bAssets, newWeights, {
                from: sa.governor,
            });

            const bAssetBefore = await mockBasketManager.getBasset(unMovedBasset);
            const bAssetIntegratorBefore = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );
            const tx = await mockBasketManager.removeBasset(bAssetToRemove, { from: sa.governor });
            expectEvent.inLogs(tx.logs, "BassetRemoved", { bAsset: bAssetToRemove });

            // Basket should still behave as normal, getting the desired details and integrator
            const bAssetAfter = await mockBasketManager.getBasset(unMovedBasset);
            equalBasset(bAssetBefore, bAssetAfter);
            const bAssetIntegratorAfter = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );
            expect(bAssetIntegratorBefore).eq(bAssetIntegratorAfter);
            // await expectRevert(mockBasketManager.integrations(1), "invalid opcode");
            const lengthAfter = (await mockBasketManager.getBassets())[0].length;
            expect(lengthBefore - 1).to.equal(lengthAfter);

            await expectRevert(mockBasketManager.getBasset(bAssetToRemove), "bAsset must exist");
        });
    });

    describe("getBasket()", async () => {
        it("gets the full basket with all parameters", async () => {
            const basket = await basketManager.getBasket();
            const bAssets = basket.bassets;
            equalBassets(bAssets, createDefaultBassets());
            expect(false).to.equal(basket.failed);
            expect(new BN(16)).to.bignumber.equal(basket.maxBassets);
            expect(fullScale).to.bignumber.equal(basket.collateralisationRatio);
        });
    });

    describe("prepareForgeBasset()", async () => {
        beforeEach(async () => {
            await createNewBasketManager();
        });

        it("should fail when contract is Paused", async () => {
            await basketManager.pause({ from: sa.governor });

            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    await expectRevert(
                        basketManager.prepareForgeBasset(a.bAsset, 0, false),
                        "Pausable: paused",
                    );
                }),
            );
        });

        it("should fail when wrong token is passed", async () => {
            await expectRevert(
                basketManager.prepareForgeBasset(sa.other, 0, false),
                "bAsset does not exist",
            );
        });

        it("should return ForgeProps", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    await basketManager.prepareForgeBasset(a.bAsset, 0, false);
                }),
            );
        });
    });

    describe("prepareForgeBassets()", async () => {
        beforeEach(async () => {
            await createNewBasketManager();
        });

        it("should fail when contract is Paused", async () => {
            await basketManager.pause({ from: sa.governor });

            await expectRevert(
                basketManager.prepareForgeBassets(
                    [integrationDetails.aTokens[0].bAsset],
                    [],
                    false,
                ),
                "Pausable: paused",
            );
        });

        it("should fail when passed duplicate items", async () => {
            await expectRevert(
                basketManager.prepareForgeBassets(
                    [
                        integrationDetails.aTokens[0].bAsset,
                        integrationDetails.aTokens[1].bAsset,
                        integrationDetails.aTokens[0].bAsset,
                    ],
                    [],
                    false,
                ),
                "Must have no duplicates",
            );
        });

        it("should fail when passed incorrect bAsset address", async () => {
            await expectRevert(
                basketManager.prepareForgeBassets([sa.dummy1], [], false),
                "Must exist",
            );
        });

        it("should return ForgePropsMulti", async () => {
            // rely on integration tests from the mAsset to ensure that the forge props are being passed correctly
        });
    });

    describe("getBassets()", async () => {
        it("should get all bAssets", async () => {
            await expectBassets(createDefaultBassets(), new BN(2));
        });
    });

    describe("getBasset()", async () => {
        it("should failed when wrong bAsset address is passed", async () => {
            await expectRevert(basketManager.getBasset(sa.other), "bAsset must exist");
        });

        it("should return bAsset", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAsset: Basset = await basketManager.getBasset(a.bAsset);
                    const expectedBasset = buildBasset(
                        a.bAsset,
                        BassetStatus.Normal,
                        false,
                        ratioScale,
                        percentToWeight(50),
                        new BN(0),
                    );
                    equalBasset(expectedBasset, bAsset);
                }),
            );
        });
    });

    describe("getBassetIntegrator()", async () => {
        it("should failed when wrong bAsset address is passed", async () => {
            await expectRevert(basketManager.getBassetIntegrator(sa.other), "bAsset must exist");
        });

        it("should return integrator address", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const integrator = await basketManager.getBassetIntegrator(a.bAsset);
                    expect(mockAaveIntegrationAddr).to.equal(integrator);
                }),
            );
        });
    });

    describe("handlePegLoss()", async () => {
        let mockBasketManager: t.MockBasketManager3Instance;

        beforeEach(async () => {
            mockBasketManager = await createMockBasketManger();
        });

        describe("should fail", async () => {
            it("when not called by manager or governor", async () => {
                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        await expectRevert(
                            mockBasketManager.handlePegLoss(a.bAsset, true, { from: sa.other }),
                            "Must be manager or governor",
                        );
                    }),
                );
            });

            it("when basket is not healthy (by manager)", async () => {
                await mockBasketManager.failBasket();

                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        await expectRevert(
                            mockBasketManager.handlePegLoss(a.bAsset, true, { from: manager }),
                            "Basket must be alive",
                        );
                    }),
                );
            });

            it("when basket is not healthy (by governor)", async () => {
                await mockBasketManager.failBasket();

                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        await expectRevert(
                            mockBasketManager.handlePegLoss(a.bAsset, true, { from: sa.governor }),
                            "Basket must be alive",
                        );
                    }),
                );
            });

            it("when bAsset not exist", async () => {
                await expectRevert(
                    mockBasketManager.handlePegLoss(sa.other, true, { from: sa.governor }),
                    "bAsset must exist in Basket",
                );
            });
        });

        it("should not change status when already BrokenBelowPeg (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.status).to.bignumber.equal(new BN(BassetStatus.Normal));

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.BrokenBelowPeg);
                    const bAssetAfterStatusChange = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenBelowPeg),
                    );

                    await mockBasketManager.handlePegLoss(a.bAsset, true, { from: sa.governor });
                    const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenBelowPeg),
                    );
                }),
            );
        });

        it("should not change status when already BrokenAbovePeg (by manager)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.status).to.bignumber.equal(new BN(BassetStatus.Normal));

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.BrokenAbovePeg);
                    const bAssetAfterStatusChange = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenAbovePeg),
                    );

                    await mockBasketManager.handlePegLoss(a.bAsset, false, { from: manager });
                    const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenAbovePeg),
                    );
                }),
            );
        });

        it("should not change status when bAsset has recolled - Liquidating (by manager)", async () => {
            const belowPegBools: Array<boolean> = [true, false];
            await Promise.all(
                belowPegBools.map(async (flag) => {
                    await Promise.all(
                        integrationDetails.aTokens.map(async (a) => {
                            const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                            expect(bAssetBefore.status).to.bignumber.equal(
                                new BN(BassetStatus.Normal),
                            );

                            await mockBasketManager.setBassetStatus(
                                a.bAsset,
                                BassetStatus.Liquidating,
                            );
                            const bAssetAfterStatusChange = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                                new BN(BassetStatus.Liquidating),
                            );

                            await mockBasketManager.handlePegLoss(a.bAsset, flag, {
                                from: manager,
                            });
                            const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                                new BN(BassetStatus.Liquidating),
                            );
                        }),
                    );
                    return null;
                }),
            );
        });

        it("should not change status when bAsset has recolled - Liquidating (by governor)", async () => {
            const belowPegBools: Array<boolean> = [true, false];
            await Promise.all(
                belowPegBools.map(async (flag) => {
                    await Promise.all(
                        integrationDetails.aTokens.map(async (a) => {
                            const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                            expect(bAssetBefore.status).to.bignumber.equal(
                                new BN(BassetStatus.Normal),
                            );

                            await mockBasketManager.setBassetStatus(
                                a.bAsset,
                                BassetStatus.Liquidating,
                            );
                            const bAssetAfterStatusChange = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                                new BN(BassetStatus.Liquidating),
                            );

                            await mockBasketManager.handlePegLoss(a.bAsset, flag, {
                                from: sa.governor,
                            });
                            const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                                new BN(BassetStatus.Liquidating),
                            );
                        }),
                    );
                    return null;
                }),
            );
        });

        it("should not change status when bAsset has recolled - Liquidated (by governor)", async () => {
            const belowPegBools: Array<boolean> = [true, false];
            await Promise.all(
                belowPegBools.map(async (flag) => {
                    await Promise.all(
                        integrationDetails.aTokens.map(async (a) => {
                            const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                            expect(bAssetBefore.status).to.bignumber.equal(
                                new BN(BassetStatus.Normal),
                            );

                            await mockBasketManager.setBassetStatus(
                                a.bAsset,
                                BassetStatus.Liquidated,
                            );
                            const bAssetAfterStatusChange = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                                new BN(BassetStatus.Liquidated),
                            );

                            await mockBasketManager.handlePegLoss(a.bAsset, flag, {
                                from: sa.governor,
                            });
                            const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                                new BN(BassetStatus.Liquidated),
                            );
                        }),
                    );
                    return null;
                }),
            );
        });

        it("should not change status when bAsset has recolled - Failed (by governor)", async () => {
            const belowPegBools: Array<boolean> = [true, false];
            await Promise.all(
                belowPegBools.map(async (flag) => {
                    await Promise.all(
                        integrationDetails.aTokens.map(async (a) => {
                            const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                            expect(bAssetBefore.status).to.bignumber.equal(
                                new BN(BassetStatus.Normal),
                            );

                            await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.Failed);
                            const bAssetAfterStatusChange = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                                new BN(BassetStatus.Failed),
                            );

                            await mockBasketManager.handlePegLoss(a.bAsset, flag, {
                                from: sa.governor,
                            });
                            const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(
                                a.bAsset,
                            );
                            expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                                new BN(BassetStatus.Failed),
                            );
                        }),
                    );
                    return null;
                }),
            );
        });
        it("should change status when (Normal, belowPeg) (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.status).to.bignumber.equal(new BN(BassetStatus.Normal));

                    const tx = await mockBasketManager.handlePegLoss(a.bAsset, true, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.BrokenBelowPeg),
                    });

                    const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenBelowPeg),
                    );
                }),
            );
        });

        it("should change status when (Normal, abovePeg) (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.status).to.bignumber.equal(new BN(BassetStatus.Normal));

                    const tx = await mockBasketManager.handlePegLoss(a.bAsset, false, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.BrokenAbovePeg),
                    });

                    const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenAbovePeg),
                    );
                }),
            );
        });

        it("should change status when (Blacklisted, belowPeg) (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.status).to.bignumber.equal(new BN(BassetStatus.Normal));

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.Blacklisted);
                    const bAssetAfterStatusChange = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                        new BN(BassetStatus.Blacklisted),
                    );

                    const tx = await mockBasketManager.handlePegLoss(a.bAsset, true, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.BrokenBelowPeg),
                    });

                    const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenBelowPeg),
                    );
                }),
            );
        });

        it("should change status when (Blacklisted, abovePeg) (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetBefore.status).to.bignumber.equal(new BN(BassetStatus.Normal));

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.Blacklisted);
                    const bAssetAfterStatusChange = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterStatusChange.status).to.bignumber.equal(
                        new BN(BassetStatus.Blacklisted),
                    );

                    const tx = await mockBasketManager.handlePegLoss(a.bAsset, false, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.BrokenAbovePeg),
                    });

                    const bAssetAfterHandlePegLoss = await mockBasketManager.getBasset(a.bAsset);
                    expect(bAssetAfterHandlePegLoss.status).to.bignumber.equal(
                        new BN(BassetStatus.BrokenAbovePeg),
                    );
                }),
            );
        });
    });

    describe("negateIsolation()", async () => {
        let mockBasketManager: t.MockBasketManager3Instance;

        beforeEach(async () => {
            mockBasketManager = await createMockBasketManger();
        });

        it("should skip when Normal (by manager)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    await mockBasketManager.negateIsolation(a.bAsset, { from: manager });
                }),
            );
        });

        it("should skip when Normal (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    await mockBasketManager.negateIsolation(a.bAsset, { from: sa.governor });
                }),
            );
        });

        it("should fail when not called by manager or governor", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    await expectRevert(
                        mockBasketManager.negateIsolation(a.bAsset, { from: sa.other }),
                        "Must be manager or governor",
                    );
                }),
            );
        });

        it("should fail when wrong bAsset address passed", async () => {
            await expectRevert(
                mockBasketManager.negateIsolation(sa.other, { from: manager }),
                "bAsset must exist",
            );

            await expectRevert(
                mockBasketManager.negateIsolation(sa.other, { from: sa.governor }),
                "bAsset must exist",
            );
        });

        it("should succeed when status is 'BrokenBelowPeg' (by manager)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(bAssetBefore.status);

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.BrokenBelowPeg);
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.BrokenBelowPeg)).to.bignumber.equal(
                        bAssetAfter.status,
                    );

                    const tx = await mockBasketManager.negateIsolation(a.bAsset, { from: manager });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.Normal),
                    });
                    const bAssetAfterNegate = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(
                        bAssetAfterNegate.status,
                    );
                }),
            );
        });

        it("should succeed when status is 'BrokenAbovePeg' (by manager)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(bAssetBefore.status);

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.BrokenAbovePeg);
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.BrokenAbovePeg)).to.bignumber.equal(
                        bAssetAfter.status,
                    );

                    const tx = await mockBasketManager.negateIsolation(a.bAsset, { from: manager });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.Normal),
                    });
                    const bAssetAfterNegate = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(
                        bAssetAfterNegate.status,
                    );
                }),
            );
        });

        it("should succeed when status is 'Blacklisted' (by manager)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(bAssetBefore.status);

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.Blacklisted);
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Blacklisted)).to.bignumber.equal(bAssetAfter.status);

                    const tx = await mockBasketManager.negateIsolation(a.bAsset, { from: manager });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.Normal),
                    });
                    const bAssetAfterNegate = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(
                        bAssetAfterNegate.status,
                    );
                }),
            );
        });

        it("should succeed when status is 'BrokenBelowPeg' (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(bAssetBefore.status);

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.BrokenBelowPeg);
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.BrokenBelowPeg)).to.bignumber.equal(
                        bAssetAfter.status,
                    );

                    const tx = await mockBasketManager.negateIsolation(a.bAsset, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.Normal),
                    });
                    const bAssetAfterNegate = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(
                        bAssetAfterNegate.status,
                    );
                }),
            );
        });

        it("should succeed when status is 'BrokenAbovePeg' (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(bAssetBefore.status);

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.BrokenAbovePeg);
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.BrokenAbovePeg)).to.bignumber.equal(
                        bAssetAfter.status,
                    );

                    const tx = await mockBasketManager.negateIsolation(a.bAsset, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.Normal),
                    });
                    const bAssetAfterNegate = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(
                        bAssetAfterNegate.status,
                    );
                }),
            );
        });

        it("should succeed when status is 'Blacklisted' (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map(async (a) => {
                    const bAssetBefore = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(bAssetBefore.status);

                    await mockBasketManager.setBassetStatus(a.bAsset, BassetStatus.Blacklisted);
                    const bAssetAfter = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Blacklisted)).to.bignumber.equal(bAssetAfter.status);

                    const tx = await mockBasketManager.negateIsolation(a.bAsset, {
                        from: sa.governor,
                    });
                    expectEvent.inLogs(tx.logs, "BassetStatusChanged", {
                        bAsset: a.bAsset,
                        status: new BN(BassetStatus.Normal),
                    });
                    const bAssetAfterNegate = await mockBasketManager.getBasset(a.bAsset);
                    expect(new BN(BassetStatus.Normal)).to.bignumber.equal(
                        bAssetAfterNegate.status,
                    );
                }),
            );
        });
    });
});
