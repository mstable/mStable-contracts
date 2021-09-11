import { PlatformTokenVendorFactory__factory } from "./../../types/generated/factories/PlatformTokenVendorFactory__factory"
import { SignatureVerifier__factory } from "./../../types/generated/factories/SignatureVerifier__factory"
import { QuestManager__factory } from "./../../types/generated/factories/QuestManager__factory"
import { StakedTokenMTA__factory } from "./../../types/generated/factories/StakedTokenMTA__factory"
import { StakedTokenBPT__factory } from "./../../types/generated/factories/StakedTokenBPT__factory"
import { formatUnits } from "@ethersproject/units"
import { ONE_DAY, ONE_WEEK } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Signer } from "ethers"
import * as hre from "hardhat"
import { deployStakingToken, StakedTokenData, StakedTokenDeployAddresses } from "tasks/utils/rewardsUtils"
import {
    IERC20,
    IERC20__factory,
    StakedTokenBPT,
    StakedTokenMTA,
    QuestManager,
    SignatureVerifier,
    PlatformTokenVendorFactory,
} from "types/generated"
import { Account } from "types"
import { getChain, getChainAddress, resolveAddress } from "../../tasks/utils/networkAddressFactory"

const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

const vaultAddresses = [
    "0xAdeeDD3e5768F7882572Ad91065f93BA88343C99",
    "0xF38522f63f40f9Dd81aBAfD2B8EFc2EC958a3016",
    "0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B",
    "0x760ea8CfDcC4e78d8b9cA3088ECD460246DC0731",
    "0xF65D53AA6e2E4A5f4F026e73cb3e22C22D75E35C",
    "0x0997dDdc038c8A958a3A3d00425C16f8ECa87deb",
    "0xD124B55f70D374F58455c8AEdf308E52Cf2A6207",
]

interface StakedTokenDeployment {
    stakedTokenBPT: StakedTokenBPT
    stakedTokenMTA: StakedTokenMTA
    questManager: QuestManager
    signatureVerifier: SignatureVerifier
    platformTokenVendorFactory: PlatformTokenVendorFactory
    mta: IERC20
    bpt: IERC20
}

// 1. Deploy core stkMTA, BPT variant & QuestManager
// 2. Gov TX's
//     1. Add StakingTokens to BoostDirector & QuestManager
//     2. Add Quest to QuestManager
//     3. Add small amt of rewards to get cogs turning
// 3. Vault contract upgrades
//     1. Upgrade
//     2. Verify balance retrieval and boosting (same on all accs)
// 4. Testing
//     1. Stake
//     2. Complete quests
//     3. Enter cooldown
//     4. Boost
// 5. Add rewards for pools
//     1. 32.5k for stkMTA, 20k for stkMBPT
// 6. Gov tx: Expire old Staking contract
context("StakedToken deployments and vault upgrades", () => {
    let deployer: Signer
    let governor: Signer
    let ethWhale: Signer

    const { network } = hre

    let deployedContracts: StakedTokenDeployment

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13198333,
                    },
                },
            ],
        })
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        ethWhale = await impersonate(ethWhaleAddress)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(10),
        })

        // Deploy StakedTokenMTA
        const stakedTokenMTA = await deployStakingToken(
            {
                rewardsTokenSymbol: "MTA",
                stakedTokenSymbol: "BPT",
                cooldown: ONE_WEEK.mul(3).toNumber(),
                unstakeWindow: ONE_WEEK.mul(2).toNumber(),
                name: "StakedTokenMTA",
                symbol: "stkMTA",
            },
            { signer: deployer, address: deployerAddress },
            hre,
        )

        // Deploy StakedTokenBPT
        const stakedTokenBPT = await deployStakingToken(
            {
                rewardsTokenSymbol: "MTA",
                stakedTokenSymbol: "BPT",
                balTokenSymbol: "BAL",
                cooldown: ONE_WEEK.mul(3).toNumber(),
                unstakeWindow: ONE_WEEK.mul(2).toNumber(),
                name: "StakedTokenBPT",
                symbol: "stkBPT",
            },
            { signer: deployer, address: deployerAddress },
            hre,
            stakedTokenMTA,
        )

        deployedContracts = {
            stakedTokenBPT: StakedTokenBPT__factory.connect(stakedTokenBPT.stakedToken, deployer),
            stakedTokenMTA: StakedTokenMTA__factory.connect(stakedTokenMTA.stakedToken, deployer),
            questManager: QuestManager__factory.connect(stakedTokenMTA.questManager, deployer),
            signatureVerifier: SignatureVerifier__factory.connect(stakedTokenMTA.signatureVerifier, deployer),
            platformTokenVendorFactory: PlatformTokenVendorFactory__factory.connect(stakedTokenMTA.platformTokenVendorFactory, deployer),
            mta: IERC20__factory.connect(resolveAddress("MTA", 0), deployer),
            bpt: IERC20__factory.connect(resolveAddress("BPT", 0), deployer),
        }
    })
    it("deploys the contracts", async () => {})
})
