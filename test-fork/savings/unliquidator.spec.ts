import { impersonateAccount } from "@utils/fork"
import { ethers, network } from "hardhat"
import { Account } from "types"
import { stkAAVE, USDC, COMP } from "tasks/utils/tokens"
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

import { resolveAddress } from "tasks/utils/networkAddressFactory"

import { keccak256, toUtf8Bytes } from "ethers/lib/utils"

const governorAddress = resolveAddress("Governor")
const liquidatorAddress = resolveAddress("Liquidator")
const treasuryAddress = resolveAddress("mStableDAO")

const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

const aaveMusdIntegrationAddress = "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E"
const aaveMbtcIntegrationAddress = "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6"
const compoundIntegrationAddress = "0xD55684f4369040C12262949Ff78299f2BC9dB735"
const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"

const toEther = (amount: BN) => ethers.utils.formatEther(amount)

context("Unliquidator forked network tests", async () => {
    let ops: Account
    let governor: Account
    let ethWhale: Account
    let stkAaveToken: ERC20
    let compToken: ERC20
    let nexus: Nexus
    let aaveMusdIntegration: PAaveIntegration
    let aaveMbtcIntegration: PAaveIntegration
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

        nexus = Nexus__factory.connect(nexusAddress, governor.signer)
        stkAaveToken = ERC20__factory.connect(stkAAVE.address, ops.signer)
        compToken = ERC20__factory.connect(COMP.address, ops.signer)

        aaveMusdIntegration = PAaveIntegration__factory.connect(aaveMusdIntegrationAddress, governor.signer)
        aaveMbtcIntegration = PAaveIntegration__factory.connect(aaveMbtcIntegrationAddress, governor.signer)
        compoundIntegration = CompoundIntegration__factory.connect(compoundIntegrationAddress, governor.signer)
    }

    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
    })

    describe("Unliquidator", async () => {
        let unliquidator: Unliquidator

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
            expect(await nexus.getModule(keccak256(toUtf8Bytes("Liquidator")))).to.eq(liquidatorAddress)
            await nexus.proposeModule(keccak256(toUtf8Bytes("Liquidator")), unliquidator.address)
            expect(await nexus.getModule(keccak256(toUtf8Bytes("Liquidator")))).to.not.eq(unliquidator.address)
        })
        it("Should accept Module in Nexus", async () => {
            increaseTime(ONE_WEEK.add(ONE_HOUR))
            await nexus.acceptProposedModule(keccak256(toUtf8Bytes("Liquidator")))
            expect(await nexus.getModule(keccak256(toUtf8Bytes("Liquidator")))).to.eq(unliquidator.address)
        })
        it("Should reapprove permissions to new Unliquidator", async () => {
            // Before no permissions
            expect(await stkAaveToken.allowance(aaveMbtcIntegrationAddress, unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.allowance(aaveMusdIntegrationAddress, unliquidator.address)).to.eq(0)
            expect(await compToken.allowance(compoundIntegrationAddress, unliquidator.address)).to.eq(0)

            // Approve tx
            await aaveMbtcIntegration.approveRewardToken()
            await aaveMusdIntegration.approveRewardToken()
            await compoundIntegration.approveRewardToken()

            // After permissions
            expect(await stkAaveToken.allowance(aaveMbtcIntegrationAddress, unliquidator.address)).to.eq(MAX_UINT256)
            expect(await stkAaveToken.allowance(aaveMusdIntegrationAddress, unliquidator.address)).to.eq(MAX_UINT256)
            // For some reason the approval is only for 79228162514264337593543950335
            expect(await compToken.allowance(compoundIntegrationAddress, unliquidator.address)).to.gt(0)
        })
        it("Should claim stkAave from mUSD and transfer to Treasury", async () => {
            // Before
            const treasuryBalBefore = await stkAaveToken.balanceOf(treasuryAddress)
            expect(await stkAaveToken.balanceOf(unliquidator.address)).to.eq(0)

            console.log(`Treasury balance before ${toEther(treasuryBalBefore)}`)

            // Claim
            expect(await unliquidator.claimAndDistributeRewards(aaveMusdIntegrationAddress, stkAAVE.address)).to.emit(
                unliquidator,
                "DistributedRewards",
            )

            console.log(`Treasury balance after ${toEther(await stkAaveToken.balanceOf(treasuryAddress))}`)

            // After
            expect(await stkAaveToken.balanceOf(unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.balanceOf(treasuryAddress)).to.gt(treasuryBalBefore)
        })
        it("Should claim stkAave from mBTC and transfer to Treasury", async () => {
            // Before
            const treasuryBalBefore = await stkAaveToken.balanceOf(treasuryAddress)
            expect(await stkAaveToken.balanceOf(unliquidator.address)).to.eq(0)

            console.log(`Treasury balance before ${toEther(treasuryBalBefore)}`)

            // Claim
            expect(await unliquidator.claimAndDistributeRewards(aaveMbtcIntegrationAddress, stkAAVE.address)).to.emit(
                unliquidator,
                "DistributedRewards",
            )

            console.log(`Treasury balance after ${toEther(await stkAaveToken.balanceOf(treasuryAddress))}`)

            // After
            expect(await stkAaveToken.balanceOf(unliquidator.address)).to.eq(0)
            expect(await stkAaveToken.balanceOf(treasuryAddress)).to.gt(treasuryBalBefore)
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
            expect(await unliquidator.distributeRewards(compoundIntegrationAddress, COMP.address)).to.emit(
                unliquidator,
                "DistributedRewards",
            )

            console.log(`Treasury balance after ${toEther(await compToken.balanceOf(treasuryAddress))}`)

            // After
            expect(await compToken.balanceOf(unliquidator.address)).to.eq(0)
            expect(await compToken.balanceOf(treasuryAddress)).to.gt(treasuryBalBefore)
        })
        it("Should set new Receiver", async () => {
            expect(await unliquidator.receiverSafe()).to.eq(treasuryAddress)
            expect(await unliquidator.connect(governor.signer).setReceiver(governor.address))
                .to.emit(unliquidator, "ReceiverUpdated")
                .withArgs(governor.address)
            expect(await unliquidator.receiverSafe()).to.eq(governor.address)
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
            expect(
                unliquidator.connect(governor.signer).claimAndDistributeRewards(aaveMusdIntegrationAddress, ZERO_ADDRESS),
            ).to.be.revertedWith("Invalid token address")
        })
        it("Should failt to triggerClaimAndDistribute with wrong contract", async () => {
            // eslint-disable-next-line
            expect(unliquidator.connect(governor.signer).claimAndDistributeRewards(DEAD_ADDRESS, stkAAVE.address)).to.be.reverted
        })
        it("Should fail to triggerDistribute with address 0", async () => {
            expect(unliquidator.connect(governor.signer).distributeRewards(ZERO_ADDRESS, stkAAVE.address)).to.be.revertedWith(
                "Invalid integration address",
            )
            expect(unliquidator.connect(governor.signer).distributeRewards(aaveMusdIntegrationAddress, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid token address",
            )
        })
    })
})
