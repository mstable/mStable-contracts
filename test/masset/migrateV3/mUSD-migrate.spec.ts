/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import { expect } from "chai"
import { Contract, ContractFactory, Signer } from "ethers"
import { ethers, network } from "hardhat"

import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { DelayedProxyAdmin, DelayedProxyAdmin__factory, Masset, Masset__factory, MusdV3, MusdV3__factory } from "types/generated"
import { increaseTime } from "@utils/time"

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { abi as MusdV2Abi, bytecode as MusdV2Bytecode } from "./MassetV2.json"
import { BassetStatus } from "@utils/mstable-objects"

// Accounts that are impersonated
const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const governorMultisigSigner = "0x4186C5AEd424876f7EBe52f9148552A45E17f287"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

// Mainnet contract addresses
const mUsdProxyAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"
const mUsdV2ImplAddress = "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4"
const basketManagerAddress = "0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D"
const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3"
const delayedProxyAdminAddress = "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
const governorMultisigAddress = "0x4186c5aed424876f7ebe52f9148552a45e17f287"
const oldForgeValidator = "0xbB90D06371030fFa150E463621c22950b212eaa1"
const invariantValidatorAddress = "0xd36050B5F28126b5292B59128ED25E489a0f2F3f"
const linkedAddress = {
    __$1a38b0db2bd175b310a9a3f8697d44eb75$__: "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848",
}

const defaultConfig = {
    a: 120,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(75, 16),
    },
}

const impersonate = async (addr): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    return ethers.provider.getSigner(addr)
}

// Test the token storage variables
const validateTokenStorage = async (token: MusdV3 | Masset) => {
    expect(await token.symbol(), "symbol").to.eq("mUSD")
    expect(await token.name(), "name").to.eq("mStable USD")
    expect(await token.decimals(), "decimals").to.eq(18)
    // some mUSD token holder
    expect(await token.balanceOf("0x5C80E54f903458edD0723e268377f5768C7869d7"), "balanceOf").to.eq("6971708003000000000000")
    // For block number 11880000
    expect(await token.totalSupply(), "totalSupply at block 11880000").to.eq("45286852911137226622051552")
}
// Test the existing Masset V2 storage variables
const validateUnchangedMassetStorage = async (mUsd: MusdV3 | Masset) => {
    expect(await mUsd.swapFee(), "swap fee").to.eq(simpleToExactAmount(6, 14))
    expect(await mUsd.redemptionFee(), "redemption fee").to.eq(simpleToExactAmount(3, 14))
    expect(await mUsd.cacheSize(), "cache size").to.eq(simpleToExactAmount(3, 16))
    expect(await mUsd.surplus(), "surplus at block 11880000").to.eq("60000000000000000001")
}
// Test the new Masset V3 storage variables
const validateNewMassetStorage = async (mUsd: MusdV3 | Masset) => {
    expect(await mUsd.forgeValidator(), "forge validator").to.eq(invariantValidatorAddress)
    expect(await mUsd.maxBassets(), "maxBassets").to.eq(10)

    // bAsset personal data
    const bAssets = await mUsd.getBassets()
    // sUSD
    expect(bAssets.personal[0].addr, "sUSD address").to.eq("0x57Ab1ec28D129707052df4dF418D58a2D46d5f51")
    expect(bAssets.personal[0].integrator, "sUSD integrator").to.eq("0xf617346A0FB6320e9E578E0C9B2A4588283D9d39") // Aave Vault
    expect(bAssets.personal[0].hasTxFee, "sUSD hasTxFee").to.be.false
    expect(bAssets.personal[0].status, "sUSD status").to.eq(BassetStatus.Normal)
    expect(bAssets.data[0].ratio, "sUSD ratio").to.eq(simpleToExactAmount(1, 26 - 18))
    expect(bAssets.data[0].vaultBalance, "sUSD vault").to.gt(simpleToExactAmount(1000, 18))
    // USDC
    expect(bAssets.personal[1].addr, "USDC address").to.eq("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
    expect(bAssets.personal[1].integrator, "USDC integrator").to.eq("0xD55684f4369040C12262949Ff78299f2BC9dB735") // Compound Vault
    expect(bAssets.personal[1].hasTxFee, "USDC hasTxFee").to.be.false
    expect(bAssets.personal[1].status, "USDC status").to.eq(BassetStatus.Normal)
    expect(bAssets.data[1].ratio, "USDC ratio").to.eq(simpleToExactAmount(1, 26 - 6))
    expect(bAssets.data[1].vaultBalance, "USDC vault").to.gt(simpleToExactAmount(20000000, 6))
    // True USD (TUSD)
    expect(bAssets.personal[2].addr, "TUSD address").to.eq("0x0000000000085d4780B73119b644AE5ecd22b376")
    expect(bAssets.personal[2].integrator, "TUSD integrator").to.eq("0xf617346A0FB6320e9E578E0C9B2A4588283D9d39") // Aave vault
    expect(bAssets.personal[2].hasTxFee, "TUSD hasTxFee").to.be.false
    expect(bAssets.personal[2].status, "TUSD status").to.eq(BassetStatus.Normal)
    expect(bAssets.data[2].ratio, "TUSD ratio").to.eq(simpleToExactAmount(1, 26 - 18))
    expect(bAssets.data[2].vaultBalance, "TUSD vault").to.gt(simpleToExactAmount(17000000, 18))
    // Tether (USDT)
    expect(bAssets.personal[3].addr, "USDT address").to.eq("0xdAC17F958D2ee523a2206206994597C13D831ec7")
    expect(bAssets.personal[3].integrator, "USDT integrator").to.eq("0xf617346A0FB6320e9E578E0C9B2A4588283D9d39") // Aave vault
    expect(bAssets.personal[3].hasTxFee, "USDT hasTxFee").to.be.false
    expect(bAssets.personal[3].status, "USDT status").to.eq(BassetStatus.Normal)
    expect(bAssets.data[3].ratio, "USDT ratio").to.eq(simpleToExactAmount(1, 26 - 6))
    expect(bAssets.data[3].vaultBalance, "USDT vault").to.gt(simpleToExactAmount(4000000, 6))

    // Get basket state
    const basketState = await mUsd.basket()
    expect(basketState.undergoingRecol, "undergoingRecol").to.be.false
    expect(basketState[0], "basketState[0]").to.be.false
    expect(basketState.failed, "undergoingRecol").to.be.false
    expect(basketState[1], "basketState[1]").to.be.false

    const invariantConfig = await mUsd.getConfig()
    expect(invariantConfig.a, "amplification coefficient (A)").to.eq(defaultConfig.a * 100)
    expect(invariantConfig.limits.min, "min limit").to.eq(defaultConfig.limits.min)
    expect(invariantConfig.limits.max, "max limit").to.eq(defaultConfig.limits.max)
}

describe("mUSD V2.0 to V3.0", () => {
    let mUsdV2Factory: ContractFactory
    let mUsdV3Factory: MusdV3__factory
    let mUsdV2: Contract
    let mUsdV3: MusdV3
    let delayedProxyAdmin: DelayedProxyAdmin
    let deployer: Signer
    let governorMultisig: Signer
    before(async () => {
        // Impersonate mainnet accounts
        deployer = await impersonate(deployerAddress)
        governorMultisig = await impersonate(governorMultisigAddress)
        const ethWhale = await impersonate(ethWhaleAddress)

        await ethWhale.sendTransaction({
            to: governorMultisigAddress,
            value: simpleToExactAmount(10),
        })

        // Point to mUSD contract using the old V2 interface via the proxy
        mUsdV2Factory = new ContractFactory(MusdV2Abi, MusdV2Bytecode, deployer)
        mUsdV2 = mUsdV2Factory.attach(mUsdProxyAddress)

        // Point to the mUSD contract using the new V3 interface via the proxy
        mUsdV3Factory = new MusdV3__factory(linkedAddress, deployer)
        mUsdV3 = mUsdV3Factory.attach(mUsdProxyAddress)
        // Check the mUSD V3 implementation contract size
        const size = mUsdV3Factory.bytecode.length / 2 / 1000
        if (size > 24.576) {
            console.error(`Masset size is ${size} kb: ${size - 24.576} kb too big`)
        } else {
            console.log(`Masset = ${size} kb`)
        }

        delayedProxyAdmin = new DelayedProxyAdmin__factory(governorMultisig).attach(delayedProxyAdminAddress)
    })
    it("Connected to forked V2 via the mUSD proxy", async () => {
        expect(await mUsdV2.getBasketManager(), "basket manager").to.eq(basketManagerAddress)
        await validateTokenStorage(mUsdV2 as Masset)
        await validateUnchangedMassetStorage(mUsdV2 as Masset)
    })
    it("Validate delayedProxyAdmin", async () => {
        expect(await delayedProxyAdmin.UPGRADE_DELAY(), "upgrade delay").to.eq(ONE_WEEK)
        expect(await delayedProxyAdmin.getProxyImplementation(mUsdProxyAddress), "delayed proxy admin").to.eq(
            "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4",
        )
        expect(await delayedProxyAdmin.getProxyAdmin(mUsdProxyAddress), "delayed proxy admin").to.eq(delayedProxyAdminAddress)
    })
    context("Upgrade proxy to point to exact old mUSD implementation", () => {
        beforeEach(async () => {
            const mUsdV2New = await mUsdV2Factory.deploy()
            // The mUSD implementation will have a blank validator
            expect(await mUsdV2New.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV2New.address, "0x")
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move the chain forward by just over 1 week
            await increaseTime(ONE_WEEK.toNumber() + 100)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
        })
        it("should preserve storage in mUSD proxy", async () => {
            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)
            expect(await mUsdV2.getBasketManager(), "basket manager").to.eq(basketManagerAddress)
        })
    })
    context("Upgrade of mUSD implementation using upgradeTo from delayed admin proxy", () => {
        before(async () => {
            const mUsdV3Impl = await mUsdV3Factory.deploy(nexusAddress)
            // The mUSD implementation will have a blank validator
            expect(await mUsdV3Impl.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, "0x")
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move the chain forward by just over 1 week
            await increaseTime(ONE_WEEK.toNumber() + 100)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
        })
        it("Should upgrade mUSD", async () => {
            // validate before the upgrade
            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)

            await mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)

            // validate after the upgrade
            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)
            await validateNewMassetStorage(mUsdV3)
        })
        it("Should fail to upgrade mUSD again", async () => {
            await expect(mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)).to.revertedWith("already upgraded")
        })
        // TODO add mint, swap and redeem
        // Do some admin operations
    })
    context.skip("Upgrade of mUSD implementation using upgradeToAndCall from delayed admin proxy", () => {
        it("migrate via time deploy admin contract", async () => {
            const mUsdV3Impl = await mUsdV3Factory.deploy(nexusAddress)
            // The mUSD implementation will have a blank validator
            expect(await mUsdV3Impl.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

            // construct the tx data to call migrate on the newly deployed mUSD V3 implementation
            const migrateCallData = mUsdV3.interface.encodeFunctionData("upgrade", [invariantValidatorAddress, defaultConfig])
            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, migrateCallData)
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move the chain forward by just over 1 week
            await increaseTime(ONE_WEEK.toNumber() + 100)
            // await delayedProxyAdmin.cancelUpgrade(mUsdProxyAddress)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            const tx = delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
            await expect(tx)
                .to.emit(delayedProxyAdmin, "Upgraded")
                .withArgs(mUsdProxyAddress, mUsdV2ImplAddress, mUsdV3.address, migrateCallData)

            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)
            await validateNewMassetStorage(mUsdV3)

            // The new mUSD implementation will still have a blank validator
            // as the mUSD storage is in the proxy
            expect(await mUsdV3Impl.forgeValidator(), "after old validator").to.eq(ZERO_ADDRESS)
        })
    })
})
