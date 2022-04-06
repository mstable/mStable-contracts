import { impersonateAccount } from "@utils/fork"
import { ethers, network } from "hardhat"
import { Account } from "types"
import { stkAAVE, USDC, COMP, USDT, WBTC, GUSD, BUSD, FEI, RAI } from "tasks/utils/tokens"
import {
    Unliquidator,
    Unliquidator__factory,
    ERC20,
    ERC20__factory,
    Nexus,
    Nexus__factory,
    PAaveIntegration,
    PAaveIntegration__factory,
    CompoundIntegration,
    CompoundIntegration__factory,
} from "types/generated"
import { Comptroller__factory } from "types/generated/factories/Comptroller__factory"

import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { ONE_HOUR, ONE_WEEK, ZERO_ADDRESS, MAX_UINT256, DEAD_ADDRESS } from "@utils/constants"

import { resolveAddress, resolveToken } from "tasks/utils/networkAddressFactory"

import { keccak256, toUtf8Bytes } from "ethers/lib/utils"

const governorAddress = resolveAddress("Governor")
const liquidatorAddress = resolveAddress("Liquidator")
const treasuryAddress = resolveAddress("mStableDAO")

const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

const toEther = (amount: BN) => ethers.utils.formatEther(amount)

context("Unliquidator forked network tests", async () => {
    let ops: Account
    let governor: Account
    let ethWhale: Account
    let stkAaveToken: ERC20
    let compToken: ERC20
    let nexusAddress: string
    let nexus: Nexus
    let aaveMusdIntegration: PAaveIntegration
    let aaveMbtcIntegration: PAaveIntegration
    let aaveGusdIntegration: PAaveIntegration
    let aaveBusdIntegration: PAaveIntegration
    let aaveFeiIntegration: PAaveIntegration
    let aaveRaiIntegration: PAaveIntegration
    let compoundIntegration: CompoundIntegration

    const runSetup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })
        ops = await impersonateAccount(resolveAddress("OperationsSigner"))
        governor = await impersonateAccount(governorAddress)
        ethWhale = await impersonateAccount(ethWhaleAddress)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.signer.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(5),
        })

        nexusAddress = resolveAddress("Nexus")
        nexus = Nexus__factory.connect(nexusAddress, governor.signer)
        stkAaveToken = ERC20__factory.connect(stkAAVE.address, ops.signer)
        compToken = ERC20__factory.connect(COMP.address, ops.signer)

        aaveMusdIntegration = PAaveIntegration__factory.connect(USDT.integrator, governor.signer)
        aaveMbtcIntegration = PAaveIntegration__factory.connect(WBTC.integrator, governor.signer)
        aaveGusdIntegration = PAaveIntegration__factory.connect(GUSD.integrator, governor.signer)
        aaveBusdIntegration = PAaveIntegration__factory.connect(BUSD.integrator, governor.signer)
        aaveFeiIntegration = PAaveIntegration__factory.connect(FEI.integrator, governor.signer)
        aaveRaiIntegration = PAaveIntegration__factory.connect(RAI.integrator, governor.signer)
        compoundIntegration = CompoundIntegration__factory.connect(USDC.integrator, governor.signer)
    }

    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
    })

    describe("Unliquidator", async () => {
        let unliquidator: Unliquidator
        const liquidatorModuleKey = keccak256(toUtf8Bytes("Liquidator"))

        before("reset block number", async () => {
            await runSetup(14179191)
        })
        it("Should deploy Unliquidator", async () => {
            unliquidator = await new Unliquidator__factory(governor.signer).deploy(resolveAddress("Nexus"), treasuryAddress)
            // eslint-disable-next-line
            expect(unliquidator.address).to.be.properAddress
            expect(await unliquidator.receiverSafe()).to.eq(treasuryAddress)
        })
        it("Should propose Module in Nexus", async () => {
            expect(await nexus.getModule(liquidatorModuleKey)).to.eq(liquidatorAddress)
            console.log(`Liquidator key ${liquidatorModuleKey}`)
            await nexus.proposeModule(liquidatorModuleKey, unliquidator.address)
            expect(await nexus.getModule(liquidatorModuleKey)).to.not.eq(unliquidator.address)
        })
        it("Should accept Module in Nexus", async () => {
            increaseTime(ONE_WEEK.add(ONE_HOUR))
            await nexus.acceptProposedModule(liquidatorModuleKey)
            expect(await nexus.getModule(liquidatorModuleKey)).to.eq(unliquidator.address)
        })
        it("Should reapprove permissions to new Unliquidator", async () => {
            // Before no permissions
            expect(await stkAaveToken.allowance(USDT.integrator, unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.allowance(WBTC.integrator, unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.allowance(GUSD.integrator, unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.allowance(BUSD.integrator, unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.allowance(FEI.integrator, unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.allowance(RAI.integrator, unliquidator.address)).to.eq(0)
            expect(await compToken.allowance(USDC.integrator, unliquidator.address)).to.eq(0)

            // Approve tx
            await aaveMusdIntegration.approveRewardToken()
            await aaveMbtcIntegration.approveRewardToken()
            await aaveGusdIntegration.approveRewardToken()
            await aaveBusdIntegration.approveRewardToken()
            await aaveFeiIntegration.approveRewardToken()
            await aaveRaiIntegration.approveRewardToken()
            await compoundIntegration.approveRewardToken()

            // After permissions
            expect(await stkAaveToken.allowance(USDT.integrator, unliquidator.address)).to.eq(MAX_UINT256)
            expect(await stkAaveToken.allowance(WBTC.integrator, unliquidator.address)).to.eq(MAX_UINT256)
            expect(await stkAaveToken.allowance(GUSD.integrator, unliquidator.address)).to.eq(MAX_UINT256)
            expect(await stkAaveToken.allowance(BUSD.integrator, unliquidator.address)).to.eq(MAX_UINT256)
            expect(await stkAaveToken.allowance(FEI.integrator, unliquidator.address)).to.eq(MAX_UINT256)
            expect(await stkAaveToken.allowance(RAI.integrator, unliquidator.address)).to.eq(MAX_UINT256)
            // For some reason the approval is only for 79228162514264337593543950335
            expect(await compToken.allowance(USDC.integrator, unliquidator.address)).to.gt(0)
        })
        describe("Should claim stkAAVE and transfer to Treasury", () => {
            // const tests = ["USDT", "WBTC", "GUSD", "BUSD", "FEI", "RAI"]
            const tests = ["USDT", "WBTC", "BUSD", "RAI"]
            // { testSymbol: "USDC", rewardSymbol: "COMP" },
            tests.forEach((testSymbol) => {
                it(`from ${testSymbol} integration`, async () => {
                    const testToken = resolveToken(testSymbol)
                    const integration = PAaveIntegration__factory.connect(testToken.integrator, ops.signer)

                    // Before
                    const treasuryBalBefore = await stkAaveToken.balanceOf(treasuryAddress)
                    expect(await stkAaveToken.balanceOf(unliquidator.address), "rewards unliquidator bal before").to.eq(0)

                    console.log(`Treasury balance before ${toEther(treasuryBalBefore)}`)

                    // Claim
                    const tx = await unliquidator.claimAndDistributeRewards(testToken.integrator, stkAaveToken.address)
                    // const receipt = await tx.wait()

                    // Check events
                    expect(tx).to.emit(unliquidator, "DistributedRewards")
                    expect(tx).to.emit(stkAaveToken, "Transfer")
                    expect(tx).to.emit(integration, "RewardsClaimed")

                    console.log(`Treasury balance after ${toEther(await stkAaveToken.balanceOf(treasuryAddress))}`)

                    // After
                    expect(await stkAaveToken.balanceOf(unliquidator.address), "rewards unliquidator bal after").to.eq(0)
                    expect(await stkAaveToken.balanceOf(treasuryAddress), "rewards treasury bal after").to.gt(treasuryBalBefore)
                })
            })
            it("Should set new Receiver", async () => {
                expect(await unliquidator.receiverSafe()).to.eq(treasuryAddress)
                expect(await unliquidator.connect(governor.signer).setReceiver(governor.address))
                    .to.emit(unliquidator, "ReceiverUpdated")
                    .withArgs(governor.address)
                expect(await unliquidator.receiverSafe()).to.eq(governor.address)
            })
        })
        it("Should transfer COMP from integration to Treasury", async () => {
            // Claim on behalf first
            const compControllerAddress = resolveAddress("CompController")
            const compController = Comptroller__factory.connect(compControllerAddress, governor.signer)
            await compController["claimComp(address,address[])"](USDC.integrator, [USDC.liquidityProvider])

            // Before
            const treasuryBalBefore = await compToken.balanceOf(treasuryAddress)
            expect(await compToken.balanceOf(unliquidator.address)).to.eq(0)

            console.log(`Treasury balance before ${toEther(treasuryBalBefore)}`)

            // Claim
            expect(await unliquidator.distributeRewards(USDC.integrator, COMP.address)).to.emit(unliquidator, "DistributedRewards")

            console.log(`Treasury balance after ${toEther(await compToken.balanceOf(treasuryAddress))}`)

            // After
            expect(await compToken.balanceOf(unliquidator.address)).to.eq(0)
            expect(await compToken.balanceOf(treasuryAddress)).to.gt(treasuryBalBefore)
        })
    })
    describe("Unliquidator should fail to deploy in the following cases", async () => {
        before("reset block number", async () => {
            await runSetup(14179191)
        })
        it("Should not deploy with nexus 0", async () => {
            expect(new Unliquidator__factory(governor.signer).deploy(ZERO_ADDRESS, treasuryAddress)).to.be.revertedWith(
                "Nexus address is zero",
            )
        })
        it("Should not deploy with receiver 0", async () => {
            expect(new Unliquidator__factory(governor.signer).deploy(nexus.address, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid receiver address",
            )
        })
    })
    describe("Unliquidator should fail after deploy", async () => {
        let unliquidator: Unliquidator

        beforeEach("reset block number", async () => {
            await runSetup(14179191)
            unliquidator = await new Unliquidator__factory(governor.signer).deploy(nexusAddress, treasuryAddress)
        })
        it("Should fail to set Receiver 0", async () => {
            expect(unliquidator.connect(governor.signer).setReceiver(ZERO_ADDRESS)).to.be.revertedWith("Invalid receiver address")
        })
        it("Should fail to set Receiver from non-Governor address", async () => {
            expect(unliquidator.connect(ops.signer).setReceiver(ops.address)).to.be.revertedWith("Only governance can execute")
        })
        it("Should fail to triggerClaimAndDistribute with address 0", async () => {
            expect(unliquidator.connect(governor.signer).claimAndDistributeRewards(ZERO_ADDRESS, stkAAVE.address)).to.be.revertedWith(
                "Invalid integration address",
            )
            expect(unliquidator.connect(governor.signer).claimAndDistributeRewards(USDT.integrator, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid token address",
            )
        })
        it("Should failt to triggerClaimAndDistribute with wrong contract", async () => {
            // eslint-disable-next-line
            expect(unliquidator.connect(governor.signer).claimAndDistributeRewards(DEAD_ADDRESS, stkAAVE.address)).to.be.reverted
        })
        it("Should fail to triggerDistribute with address 0", async () => {
            expect(unliquidator.connect(governor.signer).distributeRewards(ZERO_ADDRESS, stkAAVE.address)).to.be.revertedWith(
                "Invalid integration address",
            )
            expect(unliquidator.connect(governor.signer).distributeRewards(USDT.integrator, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid token address",
            )
        })
    })
})
