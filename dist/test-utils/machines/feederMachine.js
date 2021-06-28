"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeederMachine = void 0;
const hardhat_1 = require("hardhat");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
const constants_1 = require("@utils/constants");
const standardAccounts_1 = require("./standardAccounts");
class FeederMachine {
    constructor(massetMachine) {
        this.mAssetMachine = massetMachine;
        this.sa = massetMachine.sa;
    }
    async initAccounts(accounts) {
        this.sa = await new standardAccounts_1.StandardAccounts().initAccounts(accounts);
        return this;
    }
    async deployFeeder(feederWeights = [200, 200], mAssetWeights = [2500, 2500, 2500, 2500], useLendingMarkets = false, useInterestValidator = false, use2dp = false) {
        const mAssetDetails = await this.mAssetMachine.deployMasset(useLendingMarkets, false);
        // Mints 10k mAsset to begin with
        await this.mAssetMachine.seedWithWeightings(mAssetDetails, mAssetWeights);
        const fAsset = await this.mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", use2dp ? 2 : 18);
        const bAssets = [mAssetDetails.mAsset, fAsset];
        const feederLogic = await new generated_1.FeederLogic__factory(this.sa.default.signer).deploy();
        const feederManager = await new generated_1.FeederManager__factory(this.sa.default.signer).deploy();
        const linkedAddress = {
            __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: feederManager.address,
            __$7791d1d5b7ea16da359ce352a2ac3a881c$__: feederLogic.address,
        };
        // - Deploy InterestValidator contract
        let interestValidator;
        if (useInterestValidator) {
            interestValidator = await new generated_1.InterestValidator__factory(this.sa.default.signer).deploy(mAssetDetails.nexus.address);
            await mAssetDetails.nexus.setInterestValidator(interestValidator.address);
        }
        // - Add fAsset to lending markets
        const platformIntegration = new generated_1.MockPlatformIntegration__factory(this.sa.governor.signer).attach(mAssetDetails.integrationAddress);
        const pTokens = [];
        if (useLendingMarkets) {
            //  - Deploy mock aToken for the mAsset and fAsset
            const aTokenFactory = new generated_1.MockATokenV2__factory(this.sa.default.signer);
            const mockATokenMasset = await aTokenFactory.deploy(mAssetDetails.aavePlatformAddress, mAssetDetails.mAsset.address);
            const mockATokenFasset = await aTokenFactory.deploy(mAssetDetails.aavePlatformAddress, fAsset.address);
            pTokens.push(mockATokenMasset.address, mockATokenFasset.address);
            // - Transfer some of the mAsset and fAsset supply to the mocked Aave
            await mAssetDetails.mAsset.transfer(mAssetDetails.aavePlatformAddress, (await mAssetDetails.mAsset.totalSupply()).div(1000));
            await fAsset.transfer(mAssetDetails.aavePlatformAddress, (await fAsset.totalSupply()).div(1000));
            // - Add mAsset and fAsset to the mocked Aave platform
            const mockAave = new generated_1.MockAaveV2__factory(this.sa.default.signer).attach(mAssetDetails.aavePlatformAddress);
            await mockAave.addAToken(mockATokenMasset.address, mAssetDetails.mAsset.address);
            await mockAave.addAToken(mockATokenFasset.address, fAsset.address);
            // - Add mAsset and fAsset to the platform integration
            await platformIntegration.setPTokenAddress(mAssetDetails.mAsset.address, mockATokenMasset.address);
            await platformIntegration.setPTokenAddress(fAsset.address, mockATokenFasset.address);
        }
        // Deploy feeder pool
        const impl = await new generated_1.FeederPool__factory(linkedAddress, this.sa.default.signer).deploy(mAssetDetails.nexus.address, mAssetDetails.mAsset.address);
        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable mBTC/bBTC Feeder",
            "bBTC fPool",
            {
                addr: mAssetDetails.mAsset.address,
                integrator: useLendingMarkets ? mAssetDetails.integrationAddress : constants_1.ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            },
            {
                addr: fAsset.address,
                integrator: useLendingMarkets ? mAssetDetails.integrationAddress : constants_1.ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            },
            mAssetDetails.bAssets.map((b) => b.address),
            {
                a: math_1.BN.from(300),
                limits: {
                    min: math_1.simpleToExactAmount(20, 16),
                    max: math_1.simpleToExactAmount(80, 16), // 97%
                },
            },
        ]);
        // Deploy feeder pool proxy and call initialize on the feeder pool implementation
        const poolProxy = await new generated_1.AssetProxy__factory(this.sa.default.signer).deploy(impl.address, constants_1.DEAD_ADDRESS, data);
        // Link the feeder pool ABI to its proxy
        const pool = await new generated_1.FeederPool__factory(linkedAddress, this.sa.default.signer).attach(poolProxy.address);
        // - Add feeder pool to the platform integration whitelist
        if (useLendingMarkets) {
            await platformIntegration.addWhitelist([pool.address]);
        }
        if ((feederWeights === null || feederWeights === void 0 ? void 0 : feederWeights.length) > 0) {
            const approvals = await Promise.all(bAssets.map((b, i) => this.mAssetMachine.approveMasset(b, pool, feederWeights[i], this.sa.default.signer)));
            await pool.mintMulti(bAssets.map((b) => b.address), approvals, 0, this.sa.default.address);
        }
        return {
            pool,
            logic: feederLogic,
            manager: feederManager,
            interestValidator,
            mAsset: mAssetDetails.mAsset,
            fAsset,
            bAssets,
            pTokens,
            mAssetDetails,
        };
    }
    async getBassets(feederDetails) {
        const [personal, data] = await feederDetails.pool.getBassets();
        const bArrays = personal.map((b, i) => {
            const d = data[i];
            return {
                addr: b.addr,
                status: b.status,
                isTransferFeeCharged: b.hasTxFee,
                ratio: math_1.BN.from(d.ratio),
                vaultBalance: math_1.BN.from(d.vaultBalance),
                integratorAddr: b.integrator,
            };
        });
        const bAssetContracts = await Promise.all(bArrays.map((b) => hardhat_1.ethers.getContractAt("MockERC20", b.addr, this.sa.default.signer)));
        const integrators = (await Promise.all(bArrays.map((b) => b.integratorAddr === constants_1.ZERO_ADDRESS
            ? null
            : hardhat_1.ethers.getContractAt("MockPlatformIntegration", b.integratorAddr, this.sa.default.signer))));
        return bArrays.map((b, i) => ({
            ...b,
            contract: bAssetContracts[i],
            integrator: integrators[i],
        }));
    }
    // Gets the fAsset, mAsset or mpAsset
    async getAsset(feederDetails, assetAddress) {
        let asset;
        let isMpAsset = false;
        // If a feeder asset or mStable asset
        if (assetAddress === feederDetails.fAsset.address || assetAddress === feederDetails.mAsset.address) {
            asset = await feederDetails.pool.getBasset(assetAddress);
            // If a main pool asset
        }
        else if (feederDetails.mAssetDetails.bAssets.map((b) => b.address).includes(assetAddress)) {
            asset = await feederDetails.mAsset.getBasset(assetAddress);
            isMpAsset = true;
        }
        else {
            throw new Error(`Asset with address ${assetAddress} is not a fAsset, mAsset or mpAsset`);
        }
        const assetContract = (await hardhat_1.ethers.getContractAt("MockERC20", asset.personal.addr, this.sa.default.signer));
        const integrator = asset.personal.integrator === constants_1.ZERO_ADDRESS
            ? null
            : (await new generated_1.MockPlatformIntegration__factory(this.sa.default.signer).attach(asset.personal.integrator));
        return {
            addr: asset.personal.addr,
            status: asset.personal.status,
            isTransferFeeCharged: asset.personal.hasTxFee,
            ratio: isMpAsset ? math_1.BN.from(asset.bData.ratio) : math_1.BN.from(asset.vaultData.ratio),
            vaultBalance: isMpAsset ? math_1.BN.from(asset.bData.vaultBalance) : math_1.BN.from(asset.vaultData.vaultBalance),
            integratorAddr: asset.personal.integrator,
            contract: assetContract,
            pToken: integrator ? await integrator.callStatic["bAssetToPToken(address)"](asset.personal.addr) : null,
            integrator,
            isMpAsset,
            feederPoolOrMassetContract: isMpAsset ? feederDetails.mAsset : feederDetails.pool,
        };
    }
    async getBasketComposition(feederDetails) {
        // raw bAsset data
        const bAssets = await this.getBassets(feederDetails);
        // total supply of mAsset
        const supply = await feederDetails.pool.totalSupply();
        // get actual balance of each bAsset
        const rawBalances = await Promise.all(bAssets.map((b) => b.integrator ? b.contract.balanceOf(b.integrator.address) : b.contract.balanceOf(feederDetails.pool.address)));
        const platformBalances = await Promise.all(bAssets.map((b) => (b.integrator ? b.integrator.callStatic.checkBalance(b.addr) : math_1.BN.from(0))));
        const balances = rawBalances.map((b, i) => b.add(platformBalances[i]));
        // get overweight
        const currentVaultUnits = bAssets.map((b) => math_1.BN.from(b.vaultBalance).mul(math_1.BN.from(b.ratio)).div(constants_1.ratioScale));
        // get total amount
        const sumOfBassets = currentVaultUnits.reduce((p, c) => p.add(c), math_1.BN.from(0));
        return {
            bAssets: bAssets.map((b, i) => ({
                ...b,
                address: b.addr,
                mAssetUnits: currentVaultUnits[i],
                actualBalance: balances[i],
                rawBalance: rawBalances[i],
                platformBalance: platformBalances[i],
            })),
            totalSupply: supply,
            surplus: math_1.BN.from(0),
            sumOfBassets,
            failed: false,
            undergoingRecol: false,
        };
    }
    async approveFeeder(asset, feeder, assetQuantity, sender = this.sa.default.signer, inputIsBaseUnits = false) {
        const assetDecimals = await asset.decimals();
        const approvalAmount = inputIsBaseUnits ? math_1.BN.from(assetQuantity) : math_1.simpleToExactAmount(assetQuantity, assetDecimals);
        await asset.connect(sender).approve(feeder, approvalAmount);
        return approvalAmount;
    }
    static async getPlatformInteraction(pool, type, amount, bAsset) {
        const hasIntegrator = bAsset.integratorAddr === constants_1.ZERO_ADDRESS;
        const integratorBalBefore = await bAsset.contract.balanceOf(bAsset.integrator ? bAsset.integratorAddr : pool.address);
        if (hasIntegrator) {
            return {
                hasLendingMarket: false,
                expectInteraction: false,
                rawBalance: type === "deposit" ? integratorBalBefore.add(amount) : integratorBalBefore.sub(amount),
            };
        }
        const hasTxFee = bAsset.isTransferFeeCharged;
        if (hasTxFee) {
            return {
                hasLendingMarket: true,
                expectInteraction: true,
                amount,
                rawBalance: math_1.BN.from(0),
            };
        }
        const totalSupply = await pool.totalSupply();
        const { cacheSize, pendingFees } = await pool.data();
        const maxC = totalSupply.add(pendingFees).mul(constants_1.ratioScale).div(math_1.BN.from(bAsset.ratio)).mul(cacheSize).div(constants_1.fullScale);
        const newSum = math_1.BN.from(integratorBalBefore).add(amount);
        const expectInteraction = type === "deposit" ? newSum.gte(maxC) : amount.gt(math_1.BN.from(integratorBalBefore));
        return {
            hasLendingMarket: true,
            expectInteraction,
            amount: type === "deposit"
                ? newSum.sub(maxC.div(2))
                : math_1.minimum(maxC.div(2).add(amount).sub(math_1.BN.from(integratorBalBefore)), math_1.BN.from(bAsset.vaultBalance).sub(math_1.BN.from(integratorBalBefore))),
            rawBalance: type === "deposit"
                ? expectInteraction
                    ? maxC.div(2)
                    : newSum
                : expectInteraction
                    ? math_1.minimum(maxC.div(2), math_1.BN.from(bAsset.vaultBalance).sub(amount))
                    : math_1.BN.from(integratorBalBefore).sub(amount),
        };
    }
}
exports.FeederMachine = FeederMachine;
//# sourceMappingURL=feederMachine.js.map