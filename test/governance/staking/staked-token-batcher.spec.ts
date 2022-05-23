import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { MockNexus__factory } from "types/generated/factories/MockNexus__factory"
import {
    AssetProxy__factory,
    QuestManager__factory,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    PlatformTokenVendorFactory__factory,
    SignatureVerifier__factory,
    StakedToken,
    StakedToken__factory,
    StakedTokenBatcher,
    StakedTokenBatcher__factory,

} from "types"
import { DEAD_ADDRESS } from "index"
import { ONE_WEEK } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { increaseTime } from "@utils/time"
import { formatBytes32String } from "ethers/lib/utils"

describe("Staked Token Batcher", () => {
    let sa: StandardAccounts
    let stakedTokenBatcher: StakedTokenBatcher
    let stakedToken: StakedToken

    let nexus: MockNexus
    let rewardToken: MockERC20
    const stakedAmount = simpleToExactAmount(1000)

    async function deployStakedToken(): Promise<StakedToken> {
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        await nexus.setRecollateraliser(sa.mockRecollateraliser.address)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, simpleToExactAmount(1000000))

        const signatureVerifier = await new SignatureVerifier__factory(sa.default.signer).deploy()
        const questManagerLibraryAddresses = {
            "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier": signatureVerifier.address,
        }
        const questManagerImpl = await new QuestManager__factory(questManagerLibraryAddresses, sa.default.signer).deploy(nexus.address)
        let data = questManagerImpl.interface.encodeFunctionData("initialize", [sa.questMaster.address, sa.questSigner.address])
        const questManagerProxy = await new AssetProxy__factory(sa.default.signer).deploy(questManagerImpl.address, DEAD_ADDRESS, data)

        const platformTokenVendorFactory = await new PlatformTokenVendorFactory__factory(sa.default.signer).deploy()
        const stakedTokenLibraryAddresses = {
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactory.address,
        }
        const stakedTokenFactory = new StakedToken__factory(stakedTokenLibraryAddresses, sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            nexus.address,
            rewardToken.address,
            questManagerProxy.address,
            rewardToken.address,
            ONE_WEEK,
            false
        )
        data = stakedTokenImpl.interface.encodeFunctionData("__StakedToken_init", [
            formatBytes32String("Staked Rewards"),
            formatBytes32String("stkRWD"),
            sa.mockRewardsDistributor.address,
        ])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)
        return stakedTokenFactory.attach(stakedTokenProxy.address) as StakedToken

    }
    before("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        stakedTokenBatcher = await new StakedTokenBatcher__factory(sa.default.signer ).deploy()
        stakedToken = await deployStakedToken();
        // Distribute reward token to multiple users 
        await rewardToken.connect(sa.default.signer).approve(sa.dummy1.address, stakedAmount)
        await rewardToken.connect(sa.default.signer).transfer(sa.dummy1.address, stakedAmount)

        await rewardToken.connect(sa.default.signer).approve(sa.dummy2.address, stakedAmount)
        await rewardToken.connect(sa.default.signer).transfer(sa.dummy2.address, stakedAmount)
        
        await rewardToken.connect(sa.default.signer).approve(sa.dummy3.address, stakedAmount)
        await rewardToken.connect(sa.default.signer).transfer(sa.dummy3.address, stakedAmount)        
    })

    describe("reviewTimestamp", async () => {
        before("Stake some tokens", async () => {
            // Stake for default and user1
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
            const delegateAddress = sa.dummy1.address
            await stakedToken.connect(sa.default.signer)["stake(uint256,address)"](stakedAmount, delegateAddress)

            await rewardToken.connect(sa.dummy1.signer).approve(stakedToken.address, stakedAmount)
            await stakedToken.connect(sa.dummy1.signer)["stake(uint256,address)"](stakedAmount, delegateAddress)

            await rewardToken.connect(sa.dummy2.signer).approve(stakedToken.address, stakedAmount)
            await stakedToken.connect(sa.dummy2.signer)["stake(uint256,address)"](stakedAmount, delegateAddress)            
        })

        it("fails if the input is wrong",async  () => {
            await expect( stakedTokenBatcher.reviewTimestamp(stakedToken.address, [])).to.revertedWith("Invalid inputs")
        })    
        it("fails if one of the accounts reverts", async () => {
            await expect( stakedTokenBatcher.reviewTimestamp(stakedToken.address, [sa.default.address])).to.revertedWith("Nothing worth poking here")
        })     
        it("updates the time multiplier for one account", async () => {
             // 3 months = 1.2x
            await increaseTime(ONE_WEEK.mul(13))

            const accounts = [sa.default.address];
            const balanceDataBefore  = await stakedToken.balanceData(sa.default.address)
            await  stakedTokenBatcher.reviewTimestamp(stakedToken.address, accounts)
            const balanceDataAfter  = await stakedToken.balanceData(sa.default.address)
            expect(balanceDataAfter.timeMultiplier).to.not.be.equal(balanceDataBefore.timeMultiplier)
            expect(balanceDataAfter.timeMultiplier).to.be.equal(20)
        }) 
        it("updates the time multiplier for multiple accounts", async () => {
            // 6 months = 1.3x
            await increaseTime(ONE_WEEK.mul(13))

            const accounts = [sa.default.address, sa.dummy1.address,sa.dummy2.address];
            const balanceDataBefore  = await Promise.all(accounts.map(async (account) => stakedToken.balanceData(account)))
            await  stakedTokenBatcher.reviewTimestamp(stakedToken.address, accounts)
            const balanceDataAfter  = await Promise.all(accounts.map(async (account) => stakedToken.balanceData(account)))

            balanceDataBefore.forEach((dataBefore, i) => {
                expect(dataBefore.timeMultiplier).to.not.be.equal(balanceDataAfter[i].timeMultiplier)    
            });
            
        }) 
        it("fails if one of the accounts reverts when multiple", async () => {
            const accounts = [sa.default.address, sa.dummy1.address,  sa.dummy2.address, sa.dummy3.address];
            await increaseTime(ONE_WEEK.mul(26))

            await rewardToken.connect(sa.dummy3.signer).approve(stakedToken.address, stakedAmount)
            await stakedToken.connect(sa.dummy3.signer)["stake(uint256,address)"](stakedAmount, sa.dummy3.address)  
            await expect( stakedTokenBatcher.reviewTimestamp(stakedToken.address, accounts)).to.revertedWith("Nothing worth poking here")
        })    
    }) 


})