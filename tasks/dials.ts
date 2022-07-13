import { BN, sum, percentToWeight, simpleToExactAmount } from "@utils/math"
import { task, types } from "hardhat/config"
import "ts-node/register"
import "tsconfig-paths/register"
import { EmissionsController__factory, IERC20__factory, StakedTokenMTA__factory } from "types/generated"
import { MTA, usdFormatter } from "./utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"
import { getBlock } from "./utils/snap-utils"

interface DialData {
    disabled: boolean
    notify: boolean
    cap: number
    balance: BN
    recipient: string
}
interface DialDetails {
    dialId: number
    voteWeight: BN
    distributed: BN
    donated: BN
    rewards: BN
    disabled: boolean
}
interface DialsSnap {
    nextEpoch: number
    distributionAmounts: BN[]
    totalDialVotes: BN
    dialsData: DialData[]
    dialsDetails: DialDetails[]
    totalDistributed: BN
    totalDonated: BN
    totalRewards: BN
    emissionsControllerBalance: BN
    csv: boolean
}
/**
 * @dev This is a fork of EmissionsController.calculateRewards, any change to the smart contract should be replicated here.
 *
 * @param {Array<BN>} latestDialVotes
 * @param {Array<DialData>} dialsData
 * @param {BN} emissionForEpoch
 * @return {Object}  - Calculation rewards details { distributionAmounts, totalDialVotes, dialsData}
 */
const calculateRewards = (latestDialVotes: Array<BN>, dialsData: Array<DialData>, emissionForEpoch: BN) => {
    const dialLen = latestDialVotes.length
    // const dialVotes: Array<BN> = Array(dialLen).fill(BN.from(0))
    const dials: Array<DialData> = [...dialsData]

    // 2.0 - Calculate the total amount of dial votes ignoring any disabled dials
    const dialVotes: Array<BN> = dialsData.map((dial, i) => (dial.disabled ? BN.from(0) : latestDialVotes[i]))
    const totalDialVotes = dialVotes.reduce(sum)

    // 3.0 - Deal with the capped dials
    const distributionAmounts: Array<BN> = Array(dialLen).fill(BN.from(0))
    let postCappedVotes = totalDialVotes
    let postCappedEmission = emissionForEpoch
    for (let k = 0; k < dialLen; k += 1) {
        const dialData = dialsData[k]
        // 3.1 - If the dial has a cap and isn't disabled, check if it's over the threshold
        if (dialData.cap > 0 && !dialData.disabled) {
            const maxVotes = BN.from(dialData.cap).mul(totalDialVotes).div(100)
            // If dial has more votes than its cap
            if (dialVotes[k].gt(maxVotes)) {
                // Calculate amount of rewards for the dial
                distributionAmounts[k] = BN.from(dialData.cap).mul(emissionForEpoch).div(100)
                // Add dial rewards to balance in storage.
                // Is addition and not set as rewards could have been donated.
                dials[k] = { ...dials[k], balance: dials[k].balance.add(distributionAmounts[k]) }
                // Remove dial votes from total votes
                postCappedVotes = postCappedVotes.sub(dialVotes[k])
                // Remove capped rewards from total reward
                postCappedEmission = postCappedEmission.sub(distributionAmounts[k])
                // Set to zero votes so it'll be skipped in the next loop
                dialVotes[k] = BN.from(0)
            }
        }
    }

    // 4.0 - Calculate the distribution amounts for each dial
    for (let l = 0; l < dialLen; l += 1) {
        // Skip dial if no votes, disabled or was over cap
        if (!dialVotes[l].eq(BN.from(0)) && !postCappedVotes.eq(BN.from(0))) {
            // Calculate amount of rewards for the dial & set storage
            distributionAmounts[l] = dialVotes[l].mul(postCappedEmission).div(postCappedVotes)
            dials[l] = { ...dials[l], balance: dials[l].balance.add(distributionAmounts[l]) }
        }
    }
    return { distributionAmounts, totalDialVotes, dialsData: dials }
}

const dialNames = [
    "MTA Staking Contract",
    "BPT Staking Contract",
    "mUSD Vault",
    "mBTC Vault",
    "GUSD FP Vault",
    "BUSD FP Vault",
    "alUSD FP Vault",
    "RAI FP Vault",
    "FEI FP Vault",
    "HBTC FP Vault",
    "tBTCv2 FP Vault",
    "Polygon mUSD Vault",
    "Polygon FRAX Farm",
    "Polygon Balancer Pool",
    "Treasury DAO",
    "Votium",
    "Visor Finance",
    "Vesper Finance",
    "Idle Finance",
]

const dialsDetailsToString = (dialsDetails: Array<DialDetails>) =>
    dialsDetails
        .filter((dd) => !dd.disabled)
        .map(
            (dd) =>
                `${dialNames[dd.dialId].padStart(21)}\t${usdFormatter(dd.voteWeight, 18, 5, 2)}\t${usdFormatter(
                    dd.distributed,
                )}\t${usdFormatter(dd.donated)}\t ${usdFormatter(dd.rewards)}`,
        )
        .join("\n")

const dialsDetailsToCsv = (dialsDetails: Array<DialDetails>) =>
    dialsDetails
        .map(
            (dd, i) =>
                `${dd.dialId.toString().padStart(2)}, ${dialNames[i].padStart(21)}, ${usdFormatter(
                    dd.voteWeight,
                    18,
                    5,
                    2,
                )}, ${usdFormatter(dd.distributed)}, ${usdFormatter(dd.donated)}, ${usdFormatter(dd.rewards)}`,
        )
        .join("\n")

const outputDialsSnap = (dialsSnap: DialsSnap) => {
    if (!dialsSnap.csv) {
        console.log(`\nEmissions Controller Dials Snap at epoch ${dialsSnap.nextEpoch}`)
        console.log(`\t\t Name\tPercent\t   Distributed\t       Revenue\t\t  Total`)
        console.log(dialsDetailsToString(dialsSnap.dialsDetails))
        console.log(
            `Totals\t\t\t\t${usdFormatter(dialsSnap.totalDistributed)}\t${usdFormatter(dialsSnap.totalDonated)}\t ${usdFormatter(
                dialsSnap.totalRewards,
            )}`,
        )
        console.log("MTA in Emissions Controller", usdFormatter(dialsSnap.emissionsControllerBalance))
    } else {
        console.log(`ID, Name, Percent, Distributed, Donated, Total`)
        console.log(dialsDetailsToCsv(dialsSnap.dialsDetails))
    }
}

/**
 *
 *  1.- For each dial in the Emissions Controller
 *      1.1- Get the weighted votes as a percentage of the total weighted votes across all dials -  from voteHistory
 *      1.2- Calculate distributed MTA rewards for the next run factoring in disabled dials and reward caps for the staking contracts - topLineEmission
 *      1.3- Get the current donated MTA rewards - balance  from DialData
 *      1.4- Total rewards = distributed + donated rewards
 *   2.- Total MTA rewards to be distributed across all dials - basically the sum
 *   3.- Total MTA rewards currently donated across all dials - the sum of balance of each dial
 *   4.- Total MTA rewards across all dials = distributed + donated
 *   5.- Get MTA balance in the Emissions Controller  - // (REWARD_TOKEN.balanceOf(emissionsController))
 */
task("dials-snap", "Snaps Emissions Controller's dials")
    .addOptionalParam("csv", "Output in comma separated values", false, types.boolean)
    .addOptionalParam("block", "Block number. (default: current block)", 0, types.int)
    .setAction(async (_taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)

        const block = await getBlock(hre.ethers, _taskArgs.block)

        const emissionsControllerAddress = getChainAddress("EmissionsController", chain)
        const emissionsController = EmissionsController__factory.connect(emissionsControllerAddress, signer)
        const mtaToken = IERC20__factory.connect(MTA.address, signer)

        // Get current epoch  and simulate next epoch by adding one week
        const [, lastEpoch] = await emissionsController.epochs({
            blockTag: block.blockNumber,
        })
        const nextEpoch = lastEpoch + 1

        // 1.- For each dial in the Emissions Controller store its details
        const dialsDetails: Array<DialDetails> = []
        // 2.- Total MTA rewards to be distributed across all dials - basically the sum
        const totalDistributed = await emissionsController.topLineEmission(nextEpoch, {
            blockTag: block.blockNumber,
        })
        // 3.- Total MTA rewards currently donated across all dials - the sum of balance of each dial
        let totalDonated = BN.from(0)
        // 4.- Total MTA rewards across all dials = distributed + donated
        let totalRewards = BN.from(0)
        // 5.- Get MTA balance in the Emissions Controller
        const emissionsControllerBalance = await mtaToken.balanceOf(emissionsController.address, {
            blockTag: block.blockNumber,
        })

        // Get the latest dial votes, it helps to know the len of dials.
        const latestDialVotes = await emissionsController.getDialVotes({
            blockTag: block.blockNumber,
        })
        const dialsData: Array<DialData> = []
        for (let i = 0; i < latestDialVotes.length; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            dialsData.push(
                await emissionsController.dials(i, {
                    blockTag: block.blockNumber,
                }),
            )
        }
        // Gets the total vote of all enabled dial
        const totalDialVotes = dialsData
            .filter((dial) => !dial.disabled)
            .map((_dial, i) => latestDialVotes[i])
            .reduce(sum)

        // Calculate distributed MTA rewards for the next run factoring in disabled dials and reward caps for the staking contracts
        const calculatedRewards = calculateRewards(latestDialVotes, dialsData, totalDistributed)

        latestDialVotes.forEach(async (vote, dialId) => {
            const dialData = dialsData[dialId]
            // if the dial is disabled assign 0 to the vote
            const adjustedVote = BN.from(dialData.disabled ? 0 : vote)
            // 1.1- Get the weighted votes as a percentage of the total weighted votes across all dials (adjust if they are disabled)
            const voteWeight = percentToWeight(totalDialVotes.eq(0) ? BN.from(0) : adjustedVote.mul(10000).div(totalDialVotes))
            // 1.2- Calculate distributed MTA rewards for the next run factoring in disabled dials and reward caps
            const distributed = calculatedRewards.distributionAmounts[dialId]
            // 1.3- Get the current donated MTA rewards:  from DialData.balance
            const donated = dialData.balance
            // 1.4- Total rewards = distributed + donated rewards
            const rewards = donated.add(distributed)

            totalDonated = totalDonated.add(donated)
            totalRewards = totalRewards.add(rewards)
            dialsDetails.push({ dialId, voteWeight, distributed, donated, rewards, disabled: dialData.disabled })
        })

        outputDialsSnap({
            nextEpoch,
            dialsDetails,
            totalDistributed,
            totalDonated,
            totalRewards,
            emissionsControllerBalance,
            ...calculatedRewards,
            csv: _taskArgs.csv,
        })
    })

module.exports = {}

task("dials-dust-votes", "Gives a tiny amount of voting power to each dial")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (_taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)

        const stakedMTA = StakedTokenMTA__factory.connect(resolveAddress("StakedTokenMTA", chain), signer)
        const mta = IERC20__factory.connect(MTA.address, signer)
        const emissionsController = EmissionsController__factory.connect(resolveAddress("EmissionsController", chain), signer)

        const amount = simpleToExactAmount(1)
        await mta.approve(stakedMTA.address, amount)
        await stakedMTA["stake(uint256)"](amount)
        await emissionsController.setVoterDialWeights([
            {
                dialId: "3",
                weight: "5",
            },
            {
                dialId: "4",
                weight: "5",
            },
            {
                dialId: "5",
                weight: "5",
            },
            {
                dialId: "6",
                weight: "5",
            },
            {
                dialId: "7",
                weight: "5",
            },
            {
                dialId: "8",
                weight: "5",
            },
            {
                dialId: "9",
                weight: "5",
            },
            {
                dialId: "10",
                weight: "5",
            },
            {
                dialId: "11",
                weight: "5",
            },
            {
                dialId: "12",
                weight: "5",
            },
            {
                dialId: "13",
                weight: "5",
            },
            {
                dialId: "14",
                weight: "5",
            },
            {
                dialId: "15",
                weight: "5",
            },
            {
                dialId: "16",
                weight: "5",
            },
            {
                dialId: "17",
                weight: "5",
            },
            {
                dialId: "18",
                weight: "5",
            },
        ])
    })
