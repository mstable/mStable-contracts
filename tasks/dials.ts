import { BN, sum, percentToWeight } from "@utils/math"
import { task, types } from "hardhat/config"
import "ts-node/register"
import "tsconfig-paths/register"
import { EmissionsController__factory, StakedTokenMTA__factory } from "types/generated"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

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

const dialsDetailsToString = (dialsDetails: Array<DialDetails>) =>
    dialsDetails
        .map(
            (dd) =>
                `\t dialId: ${
                    dd.dialId
                } \t voteWeight: ${dd.voteWeight.toString()} \t distributed: ${dd.distributed.toString()} \t donated: ${dd.donated.toString()} \t rewards[${dd.rewards.toString()}`,
        )
        .join("\n")

const outputDialsSnap = (dialsSnap: DialsSnap) => {
    console.log(`Emissions Controller Dials Snap at epoch ${dialsSnap.nextEpoch}`)
    console.log(dialsDetailsToString(dialsSnap.dialsDetails))
    console.log("Total MTA rewards to be distributed across all dials:", dialsSnap.totalDistributed.toString())
    console.log("Total MTA rewards currently donated across all dials:", dialsSnap.totalDonated.toString())
    console.log("Total MTA rewards across all dials", dialsSnap.totalRewards.toString())
    console.log("Total MTA balance in the Emissions Controller", dialsSnap.emissionsControllerBalance.toString())
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
task("dials-snap", "Snaps Emissions Controller's dials").setAction(async (_taskArgs, hre) => {
    const signer = await getSigner(hre)
    const chain = getChain(hre)
    const emissionsControllerAddress = getChainAddress("EmissionsController", chain)
    const stakedTokenMTAAddress = getChainAddress("StakedTokenMTA", chain)
    const emissionsController = EmissionsController__factory.connect(emissionsControllerAddress, signer)
    const stakedTokenMTA = StakedTokenMTA__factory.connect(stakedTokenMTAAddress, signer)

    // Get current epoch  and simulate next epoch by adding one week
    const [, lastEpoch] = await emissionsController.epochs()
    const nextEpoch = lastEpoch + 1

    // 1.- For each dial in the Emissions Controller store its details
    const dialsDetails: Array<DialDetails> = []
    // 2.- Total MTA rewards to be distributed across all dials - basically the sum
    const totalDistributed = await emissionsController.topLineEmission(nextEpoch)
    // 3.- Total MTA rewards currently donated across all dials - the sum of balance of each dial
    let totalDonated = BN.from(0)
    // 4.- Total MTA rewards across all dials = distributed + donated
    let totalRewards = BN.from(0)
    // 5.- Get MTA balance in the Emissions Controller
    const emissionsControllerBalance = await stakedTokenMTA.balanceOf(emissionsController.address)

    // Get the latest dial votes, it helps to know the len of dials.
    const latestDialVotes = await emissionsController.getDialVotes()
    const dialsData: Array<DialData> = []
    for (let i = 0; i < latestDialVotes.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        dialsData.push(await emissionsController.dials(i))
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
        dialsDetails.push({ dialId, voteWeight, distributed, donated, rewards })
    })

    outputDialsSnap({
        nextEpoch,
        dialsDetails,
        totalDistributed,
        totalDonated,
        totalRewards,
        emissionsControllerBalance,
        ...calculatedRewards,
    })
})

module.exports = {}
