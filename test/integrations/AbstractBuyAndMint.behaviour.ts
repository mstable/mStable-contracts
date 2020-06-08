import * as t from "types/generated";
import { ZERO_ADDRESS, ZERO, MAX_UINT256 } from "@utils/constants";
import { AbstractBuyAndMintInstance } from "types/generated";
import { StandardAccounts } from "@utils/machines";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();
const MockERC20: t.MockErc20Contract = artifacts.require("MockERC20");

export default function shouldBehaveLikeAbstractBuyAndMint(
    ctx: { abstractBuyAndMint: AbstractBuyAndMintInstance },
    sa: StandardAccounts,
    externalDexAddress: string,
): void {
    context("AbstractBuyAndMint.infiniteApprove", async () => {
        it("should allow infinite approvals", async () => {
            // 1. Create two mock ERC20 tokens
            const mockERC1: t.MockErc20Instance = await MockERC20.new(
                "Mock1",
                "MKT1",
                18,
                sa.default,
                1000,
            );
            const mockERC2: t.MockErc20Instance = await MockERC20.new(
                "Mock2",
                "MKT2",
                18,
                sa.default,
                1000,
            );
            const mockERC20s: Array<string> = [mockERC1.address, mockERC2.address];

            // 2. Get allowance from the contract to DexContract
            const mock1AllowanceBefore: BN = await mockERC1.allowance(
                ctx.abstractBuyAndMint.address,
                externalDexAddress,
            );
            const mock2AllowanceBefore: BN = await mockERC2.allowance(
                ctx.abstractBuyAndMint.address,
                externalDexAddress,
            );

            // 3. Allowance must be ZERO
            expect(mock1AllowanceBefore).to.bignumber.equal(ZERO as any);
            expect(mock2AllowanceBefore).to.bignumber.equal(ZERO as any);

            // 4. Perform the infiniteApproval for the two tokens
            await ctx.abstractBuyAndMint.infiniteApprove(mockERC20s);

            // 5. Get allowance
            const mock1AllowanceAfter: BN = await mockERC1.allowance(
                ctx.abstractBuyAndMint.address,
                externalDexAddress,
            );
            const mock2AllowanceAfter: BN = await mockERC2.allowance(
                ctx.abstractBuyAndMint.address,
                externalDexAddress,
            );

            // 6. Validate allowance after, must be MAX_UINT256
            expect(mock1AllowanceAfter).to.bignumber.equal(MAX_UINT256);
            expect(mock2AllowanceAfter).to.bignumber.equal(MAX_UINT256);
        });
    });

    context("AbstractBuyAndMint.addMasset", async () => {
        it("should fail when non Owner calls function", async () => {
            await expectRevert(
                ctx.abstractBuyAndMint.addMasset(sa.dummy1, { from: sa.other }),
                "Ownable: caller is not the owner",
            );
        });

        it("should fail when mAsset address is zero", async () => {
            // 1. Try adding ZERO_ADDRESS
            await expectRevert(
                ctx.abstractBuyAndMint.addMasset(ZERO_ADDRESS),
                "mAsset address is zero",
            );
            // 2. Validate its not added
            expect(await ctx.abstractBuyAndMint.mAssets(ZERO_ADDRESS)).to.equal(false);
        });

        it("should fail when mAsset address already exists", async () => {
            // 1. Add mAsset
            await ctx.abstractBuyAndMint.addMasset(sa.dummy1);
            // 2. Validate newly added mAsset
            expect(await ctx.abstractBuyAndMint.mAssets(sa.dummy1)).to.equal(true);

            // 3. Try to add same mAsset
            await expectRevert(
                ctx.abstractBuyAndMint.addMasset(sa.dummy1),
                "mAsset already exists",
            );
            // 4. Validate that it still exists
            expect(await ctx.abstractBuyAndMint.mAssets(sa.dummy1)).to.equal(true);
        });

        it("should allow adding a new mAsset address", async () => {
            // 1. Add mAsset
            const tx = await ctx.abstractBuyAndMint.addMasset(sa.dummy1);
            // 2. Validate newly added mAsset
            expect(await ctx.abstractBuyAndMint.mAssets(sa.dummy1)).to.equal(true);

            expectEvent.inLogs(tx.logs, "MassetAdded", { mAsset: sa.dummy1 });
        });
    });
}
