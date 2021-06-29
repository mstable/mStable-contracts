/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import "ts-node/register"
import "tsconfig-paths/register"

import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { task, types } from "hardhat/config"
import {
    FeederPool__factory,
    FeederLogic__factory,
    MockERC20__factory,
    CompoundIntegration__factory,
    CompoundIntegration,
    RewardsDistributor__factory,
    RewardsDistributor,
} from "types/generated"
import { simpleToExactAmount, BN } from "@utils/math"
import { BUSD, CREAM, cyMUSD, FRAX, GUSD, MFRAX, MmUSD, MTA, mUSD, PFRAX, PMTA, PmUSD } from "./utils/tokens"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { getSigner } from "./utils/defender-utils"
import { CommonAddresses, deployBoostedFeederPools, Pair } from "./utils/feederUtils"

task("fSize", "Gets the bytecode size of the FeederPool.sol contract").setAction(async (_, { ethers, network }) => {
    const deployer = await getSigner(network.name, ethers)
    const linkedAddress = {
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: DEAD_ADDRESS,
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: DEAD_ADDRESS,
    }
    // Implementation
    const feederPoolFactory = new FeederPool__factory(linkedAddress, deployer)
    let size = feederPoolFactory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`FeederPool size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`FeederPool = ${size} kb`)
    }

    const logic = await new FeederLogic__factory(deployer)
    size = logic.bytecode.length / 2 / 1000
    console.log(`FeederLogic = ${size} kb`)

    // External linked library
    const manager = await ethers.getContractFactory("FeederManager")
    size = manager.bytecode.length / 2 / 1000
    console.log(`FeederManager = ${size} kb`)
})

task("deployBoostedFeeder", "Deploys feeder pools with vMTA boost")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, { hardhatArguments, ethers, network }) => {
        const deployer = await getSigner(network.name, ethers, taskArgs.speed)

        let addresses: CommonAddresses
        const pairs: Pair[] = []
        if (network.name === "mainnet" || hardhatArguments.config === "tasks-fork.config.ts") {
            addresses = {
                mta: MTA.address,
                staking: MTA.savings, // vMTA
                nexus: "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3",
                proxyAdmin: "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386",
                rewardsDistributor: "0x04dfdfa471b79cc9e6e8c355e6c71f8ec4916c50",
                aave: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
                boostDirector: "0x8892d7A5e018cdDB631F4733B5C1654e9dE10aaF",
                feederLogic: "0x2837C77527c37d61D9763F53005211dACB4125dE",
                feederManager: "0x90aE544E8cc76d2867987Ee4f5456C02C50aBd8B",
                feederRouter: "0xdc66115Be4eaA30FE8Ca3b262bB8E3FF889F3A35",
                interestValidator: "0xf1049aeD858C4eAd6df1de4dbE63EF607CfF3262", // new version replaces 0x98c54fd8c98eaf0938c4a00e7935a66341f7ba0e
            }
            pairs.push({
                mAsset: mUSD,
                fAsset: FRAX,
                aToken: ZERO_ADDRESS,
                priceCoeff: simpleToExactAmount(1),
                A: BN.from(100),
            })
        } else if (network.name === "polygon_mainnet" || hardhatArguments.config === "tasks-fork-polygon.config.ts") {
            addresses = {
                mta: PMTA.address,
                nexus: "0x3C6fbB8cbfCB75ecEC5128e9f73307f2cB33f2f6",
                proxyAdmin: "0xCb6E4B67f2cac15c284AB49B6a4A671cdfe66711",
                rewardsDistributor: "0xC42cF11c1A8768FB8306623C6f682AE966e08f0a",
                feederManager: "0xa0adbAcBc179EF9b1a9436376a590b72d1d7bfbf",
                feederLogic: "0xc929E040b6C8F2fEFE6B45c6bFEB55508554F3E2",
                interestValidator: "0x4A268958BC2f0173CDd8E0981C4c0a259b5cA291",
                boostDirector: ZERO_ADDRESS,
            }
            pairs.push({
                mAsset: PmUSD,
                fAsset: PFRAX,
                aToken: ZERO_ADDRESS,
                priceCoeff: simpleToExactAmount(1),
                A: BN.from(100),
            })
        } else if (network.name === "polygon_testnet" || hardhatArguments.config === "tasks-fork-polygon-testnet.config.ts") {
            addresses = {
                mta: PMTA.address,
                nexus: "0xCB4aabDb4791B35bDc9348bb68603a68a59be28E",
                proxyAdmin: "0x41E4fF04e6f931f6EA71C7138A79a5B2B994eF19",
                rewardsDistributor: "0x61cFA4D69Fb52e5aA7870749d91f3ec1fDce8819",
                feederManager: "0x7c290A7cdF2516Ca14A0A928E81032bE00C311b0",
                feederLogic: "0x096bE47CF32A829904C3741d272620E8745F051F",
                interestValidator: "0x644252F179499DF2dE22b14355f677d2b2E21509",
                boostDirector: ZERO_ADDRESS,
            }
            pairs.push({
                mAsset: MmUSD,
                fAsset: MFRAX,
                aToken: ZERO_ADDRESS,
                priceCoeff: simpleToExactAmount(1),
                A: BN.from(100),
            })
        } else if (network.name === "ropsten") {
            addresses = {
                mta: "0x273bc479E5C21CAA15aA8538DecBF310981d14C0",
                staking: "0x77f9bf80e0947408f64faa07fd150920e6b52015",
                nexus: "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB",
                proxyAdmin: "0x2d369F83E9DC764a759a74e87a9Bc542a2BbfdF0",
                rewardsDistributor: "0x99B62B75E3565bEAD786ddBE2642E9c40aA33465",
            }
        } else {
            addresses = {
                mta: DEAD_ADDRESS,
                staking: (await new MockERC20__factory(deployer).deploy("Stake", "ST8", 18, DEAD_ADDRESS, 1)).address,
                nexus: DEAD_ADDRESS,
                proxyAdmin: DEAD_ADDRESS,
                rewardsDistributor: DEAD_ADDRESS,
            }
        }

        if (!addresses.rewardsDistributor) {
            const fundManagerAddress = "0x437E8C54Db5C66Bb3D80D2FF156e9bfe31a017db"
            const distributor = await deployContract<RewardsDistributor>(new RewardsDistributor__factory(deployer), "RewardsDistributor", [
                addresses.nexus,
                [fundManagerAddress],
            ])
            addresses.rewardsDistributor = distributor.address
        }

        // const pairs: Pair[] = [
        //     // mBTC / hBTC
        //     {
        //         mAsset: mBTC.address,
        //         fAsset: HBTC.address,
        //         aToken: ZERO_ADDRESS,
        //         priceCoeff: simpleToExactAmount(58000),
        //         A: BN.from(325),
        //     },
        //     // mBTC / tBTC
        //     {
        //         mAsset: mBTC.address,
        //         fAsset: TBTC.address,
        //         aToken: ZERO_ADDRESS,
        //         priceCoeff: simpleToExactAmount(58000),
        //         A: BN.from(175),
        //     },
        //     // mUSD / bUSD
        //     {
        //         mAsset: mUSD.address,
        //         fAsset: BUSD.address,
        //         aToken: BUSD.liquidityProvider,
        //         priceCoeff: simpleToExactAmount(1),
        //         A: BN.from(500),
        //     },
        //     // mUSD / GUSD
        //     {
        //         mAsset: mUSD.address,
        //         fAsset: GUSD.address,
        //         aToken: GUSD.liquidityProvider,
        //         priceCoeff: simpleToExactAmount(1),
        //         A: BN.from(225),
        //     }
        // ]

        await deployBoostedFeederPools(deployer, addresses, pairs)
    })

task("deployIronBank", "Deploys mUSD Iron Bank (CREAM) integration contracts for GUSD and BUSD Feeder Pools")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, { ethers, network }) => {
        const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3"

        const deployer = await getSigner(network.name, ethers, taskArgs.speed)

        // CREAM's ABI is the same as Compound so can use the CompoundIntegration contract
        const gusdIntegration = await deployContract<CompoundIntegration>(
            new CompoundIntegration__factory(deployer),
            "CREAM Integration for GUSD FP",
            [nexusAddress, GUSD.feederPool, CREAM.address],
        )
        let tx = await gusdIntegration.initialize([mUSD.address], [cyMUSD.address])
        await logTxDetails(tx, "initialize GUSD Iron Bank integration")

        const busdIntegration = await deployContract<CompoundIntegration>(
            new CompoundIntegration__factory(deployer),
            "CREAM Integration for BUSD FP",
            [nexusAddress, BUSD.feederPool, CREAM.address],
        )
        tx = await busdIntegration.initialize([mUSD.address], [cyMUSD.address])
        await logTxDetails(tx, "initialize BUSD Iron Bank integration")

        // This will be done via the delayedProxyAdmin on mainnet
        // Governor approves Liquidator to spend the reward (CREAM) token
        const approveRewardTokenData = await gusdIntegration.interface.encodeFunctionData("approveRewardToken")
        console.log(`\napproveRewardToken data for GUSD and BUSD: ${approveRewardTokenData}`)

        const gudsFp = FeederPool__factory.connect(GUSD.address, deployer)
        const gusdMigrateBassetsData = await gudsFp.interface.encodeFunctionData("migrateBassets", [
            [mUSD.address],
            gusdIntegration.address,
        ])
        console.log(`GUSD Feeder Pool migrateBassets tx data: ${gusdMigrateBassetsData}`)

        const budsFp = FeederPool__factory.connect(BUSD.address, deployer)
        const busdMigrateBassetsData = await budsFp.interface.encodeFunctionData("migrateBassets", [
            [mUSD.address],
            busdIntegration.address,
        ])
        console.log(`BUSD Feeder Pool migrateBassets tx data: ${busdMigrateBassetsData}`)
    })

module.exports = {}
