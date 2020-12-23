/* eslint-disable no-await-in-loop */

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
import { percentToWeight, simpleToExactAmount } from "@utils/math";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import * as t from "types/generated";
import { MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { ZERO_ADDRESS, ZERO, ratioScale, fullScale, DEAD_ADDRESS } from "@utils/constants";
import { BassetIntegrationDetails, Platform } from "../../types/machines";

import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "../shared/behaviours/PausableModule.behaviour";

const { expect } = envSetup.configure();

const BasketManager = artifacts.require("BasketManager");
const AaveIntegration = artifacts.require("AaveV2Integration");
const CompoundIntegration = artifacts.require("CompoundIntegration");
const MockNexus = artifacts.require("MockNexus");
const MockBasketManager = artifacts.require("MockBasketManager3");
const MockERC20 = artifacts.require("MockERC20");
const MockCompoundIntegration = artifacts.require("MockCompoundIntegration2");
const MaliciousAaveIntegration = artifacts.require("MaliciousAaveIntegration");

contract("BasketManager", async (accounts) => {
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;

    const sa = new StandardAccounts(accounts);
    const ctx: { module?: t.BasketManagerInstance } = {};
    const masset = sa.dummy1;
    const governance = sa.dummy2;
    const manager = sa.dummy3;

    let integrationDetails: BassetIntegrationDetails;
    let aaveIntegration: t.AaveV2IntegrationInstance;
    let compoundIntegration: t.CompoundIntegrationInstance;
    let basketManager: t.BasketManagerInstance;
    let nexus: t.MockNexusInstance;

    async function createMockBasketManger(): Promise<t.MockBasketManager3Instance> {
        const mockBasketManager = await MockBasketManager.new();
        await mockBasketManager.initialize(
            nexus.address,
            masset,
            integrationDetails.bAssets.map((b) => b.address),
            integrationDetails.platforms.map((p) =>
                p === Platform.aave ? aaveIntegration.address : compoundIntegration.address,
            ),
            integrationDetails.bAssets.map(() => simpleToExactAmount(50, 16)),
            [false, false, false, false],
        );
        return mockBasketManager;
    }

    const createMockERC20 = async (decimals = 18): Promise<t.MockERC20Instance> => {
        const mockERC20 = await MockERC20.new("Mock", "MKT", decimals, sa.default, new BN(10000));
        await aaveIntegration.setPTokenAddress(
            mockERC20.address,
            integrationDetails.aTokens[0].aToken,
            {
                from: sa.governor,
            },
        );
        return mockERC20;
    };

    async function createDefaultBassets(): Promise<Array<Basset>> {
        const weight = simpleToExactAmount(50, 16);
        const decimals = await Promise.all(integrationDetails.bAssets.map((b) => b.decimals()));
        return integrationDetails.bAssets.map((b, i) =>
            buildBasset(
                b.address,
                BassetStatus.Normal,
                false,
                ratioScale.mul(new BN(10).pow(decimals[i].sub(new BN(18)))),
                weight,
                ZERO,
            ),
        );
    }

    async function expectBassets(bAssetsArr: Array<Basset>, len: BN): Promise<void> {
        const [receivedBassets, receivedLen] = await basketManager.getBassets();
        equalBassets(bAssetsArr, receivedBassets);
        expect(len).to.bignumber.equal(receivedLen);
    }

    async function createNewBasketManager(): Promise<t.BasketManagerInstance> {
        aaveIntegration = await AaveIntegration.new();
        compoundIntegration = await CompoundIntegration.new();
        basketManager = await BasketManager.new();

        await aaveIntegration.initialize(
            nexus.address,
            [masset, governance, basketManager.address],
            integrationDetails.aavePlatformAddress,
            integrationDetails.aTokens.map((a) => a.bAsset),
            integrationDetails.aTokens.map((a) => a.aToken),
        );
        await compoundIntegration.initialize(
            nexus.address,
            [masset, governance, basketManager.address],
            sa.dummy1,
            integrationDetails.cTokens.map((c) => c.bAsset),
            integrationDetails.cTokens.map((c) => c.cToken),
        );
        await basketManager.initialize(
            nexus.address,
            masset,
            integrationDetails.bAssets.map((b) => b.address),
            integrationDetails.platforms.map((p) =>
                p === Platform.aave ? aaveIntegration.address : compoundIntegration.address,
            ),
            integrationDetails.bAssets.map(() => simpleToExactAmount(50, 16)),
            [false, false, false, false],
        );

        return basketManager;
    }

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;
        integrationDetails = await massetMachine.loadBassets();

        nexus = await MockNexus.new(sa.governor, governance, manager);

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
            shouldBehaveLikePausableModule(ctx as { module: t.PausableModuleInstance }, sa);
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
                        [aaveIntegration.address, aaveIntegration.address],
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
                        [aaveIntegration.address, aaveIntegration.address],
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
                        [aaveIntegration.address, aaveIntegration.address],
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
                        [aaveIntegration.address, aaveIntegration.address],
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

            it("when weight array is empty", async () => {
                const bm = await BasketManager.new();
                await expectRevert(
                    bm.initialize(
                        nexus.address,
                        masset,
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [aaveIntegration.address, aaveIntegration.address],
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
                        [aaveIntegration.address, aaveIntegration.address],
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
                        [aaveIntegration.address, aaveIntegration.address],
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
                        [aaveIntegration.address, aaveIntegration.address],
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
                    [aaveIntegration.address, aaveIntegration.address],
                    [percentToWeight(50), percentToWeight(50)],
                    [false, false],
                );

                expectEvent.inLogs(tx.logs, "BassetAdded", {
                    bAsset: integrationDetails.aTokens[0].bAsset,
                    integrator: aaveIntegration.address,
                });

                expectEvent.inLogs(tx.logs, "BassetAdded", {
                    bAsset: integrationDetails.aTokens[1].bAsset,
                    integrator: aaveIntegration.address,
                });

                // test-helpers not supports `deep` array compare. Hence, need to test like below
                expectEvent.inLogs(tx.logs, "BasketWeightsUpdated");
                const basketWeightUpdatedEvent = tx.logs[2];
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
                await expectBassets(await createDefaultBassets(), new BN(4));

                // should have all bAsset's integrations addresses
                await Promise.all(
                    integrationDetails.aTokens.map(async (a) => {
                        const aTokenAddr = await basketManager.getBassetIntegrator(a.bAsset);
                        expect(aaveIntegration.address).to.equal(aTokenAddr);
                        return null;
                    }),
                );
            });
        });
    });

    describe("increaseVaultBalance()", async () => {
        it("should fail when called by other than masset contract", async () => {
            await Promise.all(
                integrationDetails.bAssets.map(async (b, index) => {
                    const bAssetBefore = await basketManager.getBasset(b.address);
                    await expectRevert(
                        basketManager.increaseVaultBalance(index, sa.dummy1, new BN(100), {
                            from: sa.other,
                        }),
                        "Must be called by mAsset",
                    );
                    const bAssetAfter = await basketManager.getBasset(b.address);
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
                            aaveIntegration.address,
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
                            aaveIntegration.address,
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
                integrationDetails.bAssets.map(async (b, index) => {
                    const bAssetBefore: Basset = await basketManager.getBasset(b.address);
                    await basketManager.increaseVaultBalance(
                        index,
                        aaveIntegration.address,
                        new BN(100),
                        {
                            from: masset,
                        },
                    );
                    const bAssetAfter = await basketManager.getBasset(b.address);
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
            const indexes: Array<number> = [0, 1, 2, 3];
            const increaseAmounts: Array<BN> = indexes.map(() => new BN(100));
            const integrators: Array<string> = indexes.map(() => sa.dummy1);
            const bAssetBeforeArr: Array<Basset> = await Promise.all(
                integrationDetails.aTokens.map((a) => basketManager.getBasset(a.bAsset)),
            );

            await expectRevert(
                basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                    from: sa.other,
                }),
                "Must be called by mAsset",
            );

            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    expect(bAssetBeforeArr[index].vaultBalance).to.bignumber.equal(
                        (await basketManager.getBasset(a.bAsset)).vaultBalance,
                    );
                }),
            );
        });

        it("should fail when basket is failed", async () => {
            const indexes: Array<number> = [0, 1, 2, 3];
            const increaseAmounts: Array<BN> = indexes.map(() => new BN(100));
            const integrators: Array<string> = indexes.map(() => sa.dummy1);

            const mockBasketManager = await createMockBasketManger();

            const bAssetBeforeArr: Array<Basset> = await Promise.all(
                integrationDetails.aTokens.map((a) => basketManager.getBasset(a.bAsset)),
            );

            await mockBasketManager.failBasket();

            await expectRevert(
                mockBasketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                    from: masset,
                }),
                "Basket must be alive",
            );

            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    expect(bAssetBeforeArr[index].vaultBalance).to.bignumber.equal(
                        (await basketManager.getBasset(a.bAsset)).vaultBalance,
                    );
                }),
            );
        });

        it("should succeed and increase vault balance", async () => {
            const indexes: Array<number> = [0, 1, 2, 3];
            const increaseAmounts: Array<BN> = indexes.map(() => new BN(100));
            const integrators: Array<string> = indexes.map(() => sa.dummy1);

            const bAssetBeforeArr: Array<Basset> = await Promise.all(
                integrationDetails.aTokens.map((a) => basketManager.getBasset(a.bAsset)),
            );
            await basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                from: masset,
            });
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    expect(
                        new BN(bAssetBeforeArr[index].vaultBalance).add(new BN(100)),
                    ).to.bignumber.equal((await basketManager.getBasset(a.bAsset)).vaultBalance);
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
                            aaveIntegration.address,
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
                            aaveIntegration.address,
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
                integrationDetails.bAssets.map(async (b, index) => {
                    const bAssetBefore: Basset = await basketManager.getBasset(b.address);
                    await basketManager.increaseVaultBalance(index, sa.dummy1, new BN(100), {
                        from: masset,
                    });
                    const bAssetAfter: Basset = await basketManager.getBasset(b.address);
                    expect(new BN(bAssetBefore.vaultBalance).add(new BN(100))).to.bignumber.equal(
                        bAssetAfter.vaultBalance,
                    );

                    await basketManager.decreaseVaultBalance(index, sa.dummy1, new BN(10), {
                        from: masset,
                    });
                    const bAssetAfterDecrease: Basset = await basketManager.getBasset(b.address);
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
            const indexes: Array<number> = [0, 1, 2, 3];
            const integrators: Array<string> = indexes.map(() => sa.dummy1);
            const increaseAmounts: Array<BN> = indexes.map(() => new BN(100));
            const decreaseAmounts: Array<BN> = indexes.map(() => new BN(100));

            await basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
                from: masset,
            });

            const bAssetBeforeArr: Array<Basset> = await Promise.all(
                integrationDetails.aTokens.map((a) => basketManager.getBasset(a.bAsset)),
            );
            await expectRevert(
                basketManager.decreaseVaultBalances(indexes, integrators, decreaseAmounts, {
                    from: sa.other,
                }),
                "Must be called by mAsset",
            );

            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    expect(bAssetBeforeArr[index].vaultBalance).to.bignumber.equal(
                        (await basketManager.getBasset(a.bAsset)).vaultBalance,
                    );
                }),
            );
        });

        it("should fail when invalid bAsset index", async () => {
            const indexes: Array<number> = [0, 1];
            const invalidIndexes: Array<number> = [5, 6];
            const integrators: Array<string> = [aaveIntegration.address, aaveIntegration.address];
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
            const indexes: Array<number> = [0, 1, 2, 3];
            const integrators: Array<string> = indexes.map(() => sa.dummy1);
            const increaseAmounts: Array<BN> = indexes.map(() => new BN(100));
            const decreaseAmounts: Array<BN> = indexes.map(() => new BN(100));

            await basketManager.increaseVaultBalances(indexes, integrators, increaseAmounts, {
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
            const bAsset0 = await MockERC20.at(integrationDetails.aTokens[0].bAsset);
            await bAsset0.transfer(mockCompound.address, new BN(2));

            await mockCompound.setCustomBalance(platformBalance);

            await basketManager.collectInterest({ from: masset });

            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAsset = await basketManager.getBasset(a.bAsset);
                    if (index === 0) {
                        expect(platformBalance.add(new BN(2))).to.bignumber.equal(
                            bAsset.vaultBalance,
                        );
                    } else {
                        expect(platformBalance).to.bignumber.equal(bAsset.vaultBalance);
                    }
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

    describe("migrating bAssets between platforms", () => {
        let newMigration: t.AaveV2IntegrationInstance;
        let maliciousIntegration: t.MaliciousAaveIntegrationInstance;
        let transferringAsset: t.MockERC20Instance;
        beforeEach(async () => {
            await createNewBasketManager();
            [, , transferringAsset] = integrationDetails.bAssets;
            newMigration = await AaveIntegration.new();
            await newMigration.initialize(
                nexus.address,
                [masset, basketManager.address],
                integrationDetails.aavePlatformAddress,
                integrationDetails.aTokens.map((a) => a.bAsset),
                integrationDetails.aTokens.map((a) => a.aToken),
            );
            maliciousIntegration = await MaliciousAaveIntegration.new();
            await maliciousIntegration.initialize(
                nexus.address,
                [masset, basketManager.address],
                integrationDetails.aavePlatformAddress,
                integrationDetails.aTokens.map((a) => a.bAsset),
                integrationDetails.aTokens.map((a) => a.aToken),
            );
        });
        it("should fail if passed 0 bAssets", async () => {
            await expectRevert(
                basketManager.migrateBassets([], newMigration.address, { from: sa.governor }),
                "Must migrate some bAssets",
            );
        });
        it("should fail if bAsset does not exist", async () => {
            await expectRevert(
                basketManager.migrateBassets([DEAD_ADDRESS], newMigration.address, {
                    from: sa.governor,
                }),
                "bAsset does not exist",
            );
        });
        it("should fail if integrator address is the same", async () => {
            await expectRevert(
                basketManager.migrateBassets([transferringAsset.address], aaveIntegration.address, {
                    from: sa.governor,
                }),
                "Must transfer to new integrator",
            );
        });
        it("should fail if new address is a dud", async () => {
            await expectRevert.unspecified(
                basketManager.migrateBassets([transferringAsset.address], DEAD_ADDRESS, {
                    from: sa.governor,
                }),
            );
        });
        it("should fail if the full amount is not transferred and deposited", async () => {
            await transferringAsset.transfer(aaveIntegration.address, new BN(10000));
            await aaveIntegration.deposit(transferringAsset.address, new BN(9000), false, {
                from: governance,
            });
            await expectRevert(
                basketManager.migrateBassets(
                    [transferringAsset.address],
                    maliciousIntegration.address,
                    {
                        from: sa.governor,
                    },
                ),
                "Must transfer full amount",
            );
        });
        it("should move all bAssets from a to b", async () => {
            await transferringAsset.transfer(aaveIntegration.address, new BN(10000));
            await aaveIntegration.deposit(transferringAsset.address, new BN(9000), false, {
                from: governance,
            });
            // get balances before
            const bal = await aaveIntegration.checkBalance.call(transferringAsset.address);
            expect(bal).bignumber.eq(new BN(9000));
            const rawBal = await transferringAsset.balanceOf(aaveIntegration.address);
            expect(rawBal).bignumber.eq(new BN(1000));
            let integratorAddress = await basketManager.getBassetIntegrator(
                transferringAsset.address,
            );
            expect(integratorAddress).eq(aaveIntegration.address);
            // call migrate
            const tx = await basketManager.migrateBassets(
                [transferringAsset.address],
                newMigration.address,
                {
                    from: sa.governor,
                },
            );
            // moves all bAssets from old to new
            const migratedBal = await newMigration.checkBalance.call(transferringAsset.address);
            expect(migratedBal).bignumber.eq(bal);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            expect(migratedRawBal).bignumber.eq(rawBal);
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(aaveIntegration.address);
            expect(newRawBal).bignumber.eq(new BN(0));
            // updates the integrator address
            integratorAddress = await basketManager.getBassetIntegrator(transferringAsset.address);
            expect(integratorAddress).eq(newMigration.address);
            // emits BassetsMigrated
            await expectEvent(tx.receipt, "BassetsMigrated", {
                bAssets: [transferringAsset.address],
                newIntegrator: newMigration.address,
            });
        });
        it("should pass if either rawBalance or balance are 0", async () => {
            await transferringAsset.transfer(aaveIntegration.address, new BN(10000));
            await aaveIntegration.deposit(transferringAsset.address, new BN(10000), false, {
                from: governance,
            });
            // get balances before
            const bal = await aaveIntegration.checkBalance.call(transferringAsset.address);
            expect(bal).bignumber.eq(new BN(10000));
            const rawBal = await transferringAsset.balanceOf(aaveIntegration.address);
            expect(rawBal).bignumber.eq(new BN(0));
            let integratorAddress = await basketManager.getBassetIntegrator(
                transferringAsset.address,
            );
            expect(integratorAddress).eq(aaveIntegration.address);
            // call migrate
            const tx = await basketManager.migrateBassets(
                [transferringAsset.address],
                newMigration.address,
                {
                    from: sa.governor,
                },
            );
            // moves all bAssets from old to new
            const migratedBal = await newMigration.checkBalance.call(transferringAsset.address);
            expect(migratedBal).bignumber.eq(bal);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            expect(migratedRawBal).bignumber.eq(rawBal);
            // updates the integrator address
            integratorAddress = await basketManager.getBassetIntegrator(transferringAsset.address);
            expect(integratorAddress).eq(newMigration.address);
            // emits BassetsMigrated
            await expectEvent(tx.receipt, "BassetsMigrated", {
                bAssets: [transferringAsset.address],
                newIntegrator: newMigration.address,
            });
        });
    });

    describe("addBasset()", async () => {
        let mockERC20: t.MockERC20Instance;
        beforeEach(async () => {
            await createNewBasketManager();
            mockERC20 = await createMockERC20();
        });

        describe("should fail", async () => {
            it("when called by other than governor", async () => {
                await expectRevert(
                    basketManager.addBasset(mockERC20.address, aaveIntegration.address, false, {
                        from: sa.other,
                    }),
                    "Only governor can execute",
                );
            });

            it("when basket is failed", async () => {
                const mockBasketManager = await createMockBasketManger();
                await mockBasketManager.failBasket();
                await expectRevert(
                    mockBasketManager.addBasset(mockERC20.address, aaveIntegration.address, false, {
                        from: sa.governor,
                    }),
                    "Basket must be alive",
                );
            });

            it("when bAsset address is zero", async () => {
                await expectRevert(
                    basketManager.addBasset(ZERO_ADDRESS, aaveIntegration.address, false, {
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
                            basketManager.addBasset(a.bAsset, aaveIntegration.address, false, {
                                from: sa.governor,
                            }),
                            "bAsset already exists in Basket",
                        );
                    }),
                );
            });

            it("when max bAssets reached", async () => {
                const mockERC20s: Array<t.MockERC20Instance> = new Array(13);
                for (let index = 0; index < 6; index += 1) {
                    const mock = await createMockERC20();
                    mockERC20s.push(mock);
                }

                let bAssets = await basketManager.getBassets();
                const lengthBefore = bAssets[0].length;
                expect(4).to.equal(lengthBefore);

                await Promise.all(
                    mockERC20s.map((a) =>
                        basketManager.addBasset(a.address, aaveIntegration.address, false, {
                            from: sa.governor,
                        }),
                    ),
                );

                bAssets = await basketManager.getBassets();
                const lengthAfter = bAssets[0].length;
                expect(10).to.equal(lengthAfter);

                await expectRevert(
                    basketManager.addBasset(mockERC20.address, aaveIntegration.address, false, {
                        from: sa.governor,
                    }),
                    "Max bAssets in Basket",
                );
            });
        });

        it("should add a new bAsset with 18 decimals", async () => {
            let bAssets = await basketManager.getBassets();
            const lengthBefore = bAssets[0].length;
            expect(4).to.equal(lengthBefore);

            const tx = await basketManager.addBasset(
                mockERC20.address,
                aaveIntegration.address,
                false,
                {
                    from: sa.governor,
                },
            );
            expectEvent.inLogs(tx.logs, "BassetAdded", {
                bAsset: mockERC20.address,
                integrator: aaveIntegration.address,
            });

            bAssets = await basketManager.getBassets();
            const lengthAfter = bAssets[0].length;
            expect(5).to.equal(lengthAfter);

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
            expect(integrator).eq(aaveIntegration.address);
        });

        it("should add a new bAsset with 10 decimals", async () => {
            mockERC20 = await createMockERC20(10);
            let bAssets = await basketManager.getBassets();
            const lengthBefore = bAssets[0].length;
            expect(4).to.equal(lengthBefore);

            const tx = await basketManager.addBasset(
                mockERC20.address,
                aaveIntegration.address,
                false,
                {
                    from: sa.governor,
                },
            );
            expectEvent.inLogs(tx.logs, "BassetAdded", {
                bAsset: mockERC20.address,
                integrator: aaveIntegration.address,
            });

            bAssets = await basketManager.getBassets();
            const lengthAfter = bAssets[0].length;
            expect(5).to.equal(lengthAfter);

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
            expect(integrator).eq(aaveIntegration.address);
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

            it("when bAssetWeight is greater than 100%", async () => {
                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        integrationDetails.aTokens.map((a) => a.bAsset),
                        [percentToWeight(101), percentToWeight(45)],
                        { from: sa.governor },
                    ),
                    "Asset weight must be <= 100%",
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
                const mockERC20 = await createMockERC20();
                await mockBasketManager.addBasset(
                    mockERC20.address,
                    aaveIntegration.address,
                    false,
                    {
                        from: sa.governor,
                    },
                );
                await expectRevert(
                    mockBasketManager.setBasketWeights(
                        [...integrationDetails.bAssets.map((b) => b.address), mockERC20.address],
                        [
                            percentToWeight(80),
                            percentToWeight(70),
                            percentToWeight(80),
                            percentToWeight(90),
                            percentToWeight(90),
                        ],
                        { from: sa.governor },
                    ),
                    "Basket weight must be >= 100 && <= 400%",
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
                [percentToWeight(50), percentToWeight(40)],
                { from: sa.governor },
            );

            const expectedWeight: Array<BN> = [percentToWeight(50), percentToWeight(40)];
            await Promise.all(
                integrationDetails.aTokens.map(async (a, index) => {
                    const bAsset: Basset = await mockBasketManager.getBasset(a.bAsset);
                    expect(expectedWeight[index]).to.bignumber.equal(bAsset.maxWeight);
                }),
            );
        });
        it("should update the weights even with affected bAsset", async () => {
            const { bAssets } = integrationDetails;
            await Promise.all(
                bAssets.map(async (b) => {
                    const bAsset: Basset = await mockBasketManager.getBasset(b.address);
                    expect(percentToWeight(50)).to.bignumber.equal(bAsset.maxWeight);
                }),
            );
            const mockERC20 = await createMockERC20();
            await mockBasketManager.addBasset(mockERC20.address, aaveIntegration.address, false, {
                from: sa.governor,
            });
            await mockBasketManager.setBassetStatus(
                bAssets[1].address,
                BassetStatus.BrokenBelowPeg,
            );

            await mockBasketManager.setBasketWeights(
                [...bAssets.map((b) => b.address), mockERC20.address],
                [
                    percentToWeight(30),
                    percentToWeight(50),
                    percentToWeight(20),
                    percentToWeight(20),
                    percentToWeight(20),
                ],
                { from: sa.governor },
            );

            const expectedWeight: Array<BN> = [
                percentToWeight(30),
                percentToWeight(50),
                percentToWeight(20),
                percentToWeight(20),
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

        it("should succeed and deposit outstanding bAsset when called by governor", async () => {
            const { bAsset } = integrationDetails.aTokens[0];
            let details: Basset = await basketManager.getBasset(bAsset);
            const contract = await MockERC20.at(bAsset);
            const integrator = await basketManager.getBassetIntegrator(bAsset);
            const integratorContract = await CompoundIntegration.at(integrator);

            await contract.transfer(integrator, new BN(100000));
            expect(false).to.equal(details.isTransferFeeCharged);

            const tx = await basketManager.setTransferFeesFlag(bAsset, true, {
                from: sa.governor,
            });
            expectEvent.inLogs(tx.logs, "TransferFeeEnabled", {
                bAsset,
                enabled: true,
            });

            expect(await integratorContract.checkBalance.call(bAsset)).bignumber.eq(new BN(100000));
            expect(await contract.balanceOf(integrator)).bignumber.eq(new BN(0));

            details = await basketManager.getBasset(bAsset);
            expect(true).to.equal(details.isTransferFeeCharged);
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
                const { bAssets } = integrationDetails;
                const bAssetToRemove = bAssets[0].address;

                const lengthBefore = (await basketManager.getBassets())[0].length;

                await basketManager.increaseVaultBalance(0, aaveIntegration.address, new BN(100), {
                    from: masset,
                });

                const newWeights = [
                    percentToWeight(0),
                    percentToWeight(50),
                    percentToWeight(50),
                    percentToWeight(50),
                ];
                await basketManager.setBasketWeights(
                    bAssets.map((b) => b.address),
                    newWeights,
                    { from: sa.governor },
                );
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
                const newWeights = [percentToWeight(0), percentToWeight(50)];
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
            const bAssetToRemove = integrationDetails.bAssets[0].address;
            const unMovedBasset = integrationDetails.bAssets[1].address;
            const movedBasset = integrationDetails.bAssets[3].address;

            const lengthBefore = (await mockBasketManager.getBassets())[0].length;

            const bAssets = integrationDetails.bAssets.map((b) => b.address);
            const newWeights = [
                percentToWeight(0),
                percentToWeight(50),
                percentToWeight(40),
                percentToWeight(30),
            ];
            await mockBasketManager.setBasketWeights(bAssets, newWeights, {
                from: sa.governor,
            });
            const unmovedBassetBefore = await mockBasketManager.getBasset(unMovedBasset);
            const movedBassetBefore = await mockBasketManager.getBasset(movedBasset);
            const unmovedBassetIntegratorBefore = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );
            const movedBassetIntegratorBefore = await mockBasketManager.getBassetIntegrator(
                movedBasset,
            );

            const tx = await mockBasketManager.removeBasset(bAssetToRemove, { from: manager });
            expectEvent.inLogs(tx.logs, "BassetRemoved", { bAsset: bAssetToRemove });

            // Basket should still behave as normal, getting the desired details and integrator
            const unmovedBassetAfter = await mockBasketManager.getBasset(unMovedBasset);
            const movedBassetAfter = await mockBasketManager.getBasset(movedBasset);
            const unmovedBassetIntegratorAfter = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );
            const movedBassetIntegratorAfter = await mockBasketManager.getBassetIntegrator(
                movedBasset,
            );
            await expectRevert.assertion(mockBasketManager.integrations(3));

            expect(unmovedBassetIntegratorBefore).eq(unmovedBassetIntegratorAfter);
            expect(movedBassetIntegratorBefore).eq(movedBassetIntegratorAfter);
            expect(unmovedBassetBefore.maxWeight).eq(unmovedBassetAfter.maxWeight);
            expect(movedBassetBefore.maxWeight).eq(movedBassetAfter.maxWeight);
            const lengthAfter = (await mockBasketManager.getBassets())[0].length;
            expect(lengthBefore - 1).to.equal(lengthAfter);

            await expectRevert(mockBasketManager.getBasset(bAssetToRemove), "bAsset must exist");
        });
        it("should remove the last bAsset in the array", async () => {
            const mockBasketManager = await createMockBasketManger();
            const bAssetToRemove = integrationDetails.bAssets[3].address;
            const unMovedBasset = integrationDetails.bAssets[1].address;

            const lengthBefore = (await mockBasketManager.getBassets())[0].length;

            const bAssets = integrationDetails.bAssets.map((b) => b.address);
            const newWeights = [
                percentToWeight(30),
                percentToWeight(50),
                percentToWeight(40),
                percentToWeight(0),
            ];
            await mockBasketManager.setBasketWeights(bAssets, newWeights, {
                from: sa.governor,
            });
            const unmovedBassetBefore = await mockBasketManager.getBasset(unMovedBasset);
            const unmovedBassetIntegratorBefore = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );

            const tx = await mockBasketManager.removeBasset(bAssetToRemove, { from: manager });
            expectEvent.inLogs(tx.logs, "BassetRemoved", { bAsset: bAssetToRemove });

            // Basket should still behave as normal, getting the desired details and integrator
            const unmovedBassetAfter = await mockBasketManager.getBasset(unMovedBasset);
            const unmovedBassetIntegratorAfter = await mockBasketManager.getBassetIntegrator(
                unMovedBasset,
            );
            await expectRevert.assertion(mockBasketManager.integrations(3));

            expect(unmovedBassetIntegratorBefore).eq(unmovedBassetIntegratorAfter);
            expect(unmovedBassetBefore.maxWeight).eq(unmovedBassetAfter.maxWeight);
            const lengthAfter = (await mockBasketManager.getBassets())[0].length;
            expect(lengthBefore - 1).to.equal(lengthAfter);

            await expectRevert(mockBasketManager.getBasset(bAssetToRemove), "bAsset must exist");
        });
    });

    describe("getBasket()", async () => {
        it("gets the full basket with all parameters", async () => {
            const basket = await basketManager.getBasket();
            const bAssets = basket.bassets;
            equalBassets(bAssets, await createDefaultBassets());
            expect(false).to.equal(basket.failed);
            expect(new BN(10)).to.bignumber.equal(basket.maxBassets);
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
                "bAsset must exist",
            );
        });

        it("should return ForgePropsMulti", async () => {
            // rely on integration tests from the mAsset to ensure that the forge props are being passed correctly
        });
    });

    describe("prepare redeem bAssets", async () => {
        it("should fail when contract is Paused", async () => {
            await basketManager.pause({ from: sa.governor });

            await expectRevert(
                basketManager.prepareRedeemBassets([integrationDetails.aTokens[0].bAsset]),
                "Pausable: paused",
            );
            await basketManager.unpause({ from: sa.governor });
        });

        it("should fail when passed duplicate items", async () => {
            await expectRevert(
                basketManager.prepareRedeemBassets([
                    integrationDetails.aTokens[0].bAsset,
                    integrationDetails.aTokens[1].bAsset,
                    integrationDetails.aTokens[0].bAsset,
                ]),
                "Must have no duplicates",
            );
        });

        it("should fail when passed incorrect bAsset address", async () => {
            await expectRevert(
                basketManager.prepareRedeemBassets([sa.dummy1]),
                "bAsset must exist",
            );
        });
        it("shold return redeemProps", async () => {
            const { bAsset } = integrationDetails.aTokens[0];
            const response = await basketManager.prepareRedeemBassets([bAsset]);
            expect(response.isValid).eq(true);
            await expectBassets(response.allBassets, new BN(4));
            expect(response.bAssets.length).eq(1);
            expect(response.bAssets[0].addr).eq(bAsset);
            expect(response.indexes[0]).bignumber.eq(new BN(2));
        });
    });

    describe("getBassets()", async () => {
        it("should get all bAssets", async () => {
            await expectBassets(await createDefaultBassets(), new BN(4));
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
                    expect(aaveIntegration.address).to.equal(integrator);
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
                integrationDetails.aTokens.map((a) =>
                    mockBasketManager.negateIsolation(a.bAsset, { from: manager }),
                ),
            );
        });

        it("should skip when Normal (by governor)", async () => {
            await Promise.all(
                integrationDetails.aTokens.map((a) =>
                    mockBasketManager.negateIsolation(a.bAsset, { from: sa.governor }),
                ),
            );
        });

        it("should fail when not called by manager or governor", async () => {
            await Promise.all(
                integrationDetails.aTokens.map((a) =>
                    expectRevert(
                        mockBasketManager.negateIsolation(a.bAsset, { from: sa.other }),
                        "Must be manager or governor",
                    ),
                ),
            );
        });

        it("should fail when wrong bAsset address passed", async () => {
            await expectRevert(
                mockBasketManager.negateIsolation(sa.other, { from: manager }),
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
    describe("failBasset()", async () => {
        beforeEach(async () => {
            await createNewBasketManager();
        });
        context("when the bAsset doesn't exist", async () => {
            it("should always fail", async () => {
                expectRevert(
                    basketManager.failBasset(sa.dummy1, { from: sa.governor }),
                    "bAsset must exist",
                );
            });
        });
        context("when there are no affected bAssets", async () => {
            it("should always fail", async () => {
                const { bAssets } = integrationDetails;
                await Promise.all(
                    bAssets.map(async (b) => {
                        const bAsset = await basketManager.getBasset(b.address);
                        expect(bAsset.status.toString()).eq(BassetStatus.Normal.toString());
                        return expectRevert(
                            basketManager.failBasset(bAsset.addr, { from: sa.governor }),
                            "bAsset must be affected",
                        );
                    }),
                );
            });
        });

        context("when called by invalid account", async () => {
            it("should always fail", async () => {
                const { bAssets } = integrationDetails;
                const bAsset = await basketManager.getBasset(bAssets[0].address);
                expect(bAsset.status.toString()).eq(BassetStatus.Normal.toString());
                return expectRevert(
                    basketManager.failBasset(bAsset.addr, { from: sa.default }),
                    "Only governor can execute",
                );
            });
        });
        context("when a bAsset has completely failed", async () => {
            it("should set the failed prop on the basket", async () => {
                const { bAssets } = integrationDetails;

                // Get current failed status
                let basket = await basketManager.getBasket();
                expect(basket.failed).eq(false);

                // Prepare the bAsset
                const targetBasset = bAssets[0].address;
                await basketManager.handlePegLoss(targetBasset, true, { from: sa.governor });
                const bAsset = await basketManager.getBasset(targetBasset);
                expect(bAsset.status.toString()).eq(BassetStatus.BrokenBelowPeg.toString());

                // Failed
                await basketManager.failBasset(targetBasset, { from: sa.governor });

                // Assert props set
                basket = await basketManager.getBasket();
                expect(basket.failed).eq(true);
            });
        });
    });
});
