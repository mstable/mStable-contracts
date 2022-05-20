import { subtask, task, types } from "hardhat/config"
import { StakedTokenBPT__factory, StakedTokenMTA__factory, StakedToken__factory } from "types/generated"
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "@ethersproject/units"
import { ONE_WEEK } from "@utils/constants"
import { gql, GraphQLClient } from "graphql-request"
import { Signer } from "ethers"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { usdFormatter } from "./utils/quantity-formatters"
import { getBlock } from "./utils/snap-utils"

interface Account {
    id: string
    stakedTokenAccounts: Array<{ id: string }>
}
const NO_TIME_MULTIPLIER_UPDATE = "NO_TIME_MULTIPLIER_UPDATE"
const BATCH_SIZE = 50
const QUERY_SIZE = 1000

async function fetchAllStakers(): Promise<Array<Account>> {
    // TODO = it has a limit of 1000 accounts, it needs pagination to bring all accounts or find the way to pass "limit -1" to the query.
    // https://dune.com/queries/161334/315606
    const gqlClient = new GraphQLClient("https://api.thegraph.com/subgraphs/name/mstable/mstable-staking")
    const query = gql`{
        accounts(first: ${QUERY_SIZE}) {
          id
          stakedTokenAccounts {
            id
          }
        }
        _meta {
          block {
            number
            hash
          }
        }
      }`

    const gqlData = await gqlClient.request(query)
    const accounts = gqlData.accounts
    // eslint-disable-next-line no-underscore-dangle
    const blockNumber = gqlData._meta.block.number
    console.log(`staked-time:: fetchAllStakersHolders for block number: ${blockNumber} accounts total: ${accounts.length}`)
    return accounts
}


function filterAccountsByStakingToken(accounts: Array<Account>, stakingTokenAddress: string): Array<string> {

    const isStakingTokenAccount = (account: Account) => account.stakedTokenAccounts.find(a => a.id.toLowerCase().includes(stakingTokenAddress))
    const stakerHolders = accounts.filter(isStakingTokenAccount).map((a: Account) => a.id)

    console.log(`staked-time:: filterAccountsByStakingToken accounts total: ${accounts.length}`)
    return stakerHolders
}
async function filterAccountsTimeMultiplier(accounts: Array<string>, stakingTokenAddress: string, signer: Signer): Promise<Array<string>> {
    const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)

    const tryReviewTimestamp = async (accountAddress: string): Promise<string> => stakingToken.callStatic.reviewTimestamp(accountAddress).then(() => accountAddress).catch(() => NO_TIME_MULTIPLIER_UPDATE)
    const accountsToUpdate = []
    let progress = BATCH_SIZE > accounts.length ? accounts.length : BATCH_SIZE
    let promises = []
    for (let i = 0; i < accounts.length; i++) {
        const accountAddress = accounts[i]
        promises.push(tryReviewTimestamp(accountAddress))
        if (progress < i || i === accounts.length - 1) {
            console.log(`staked-time:: filterAccountsTimeMultiplier validating: ${progress} out of ${accounts.length}`, new Date())
            progress = progress + BATCH_SIZE > accounts.length ? accounts.length : progress + BATCH_SIZE
            // eslint-disable-next-line no-await-in-loop
            const resolved = (await Promise.all(promises)).filter(result => result !== NO_TIME_MULTIPLIER_UPDATE)
            promises = [] // clean buffer of promises
            accountsToUpdate.push(...resolved)
        }
    }
    console.log(`staked-time:: filterAccountsTimeMultiplier ${accountsToUpdate.length} out of ${accounts.length}
    accounts: 
    ${accountsToUpdate.join(",")}`)

    return accountsToUpdate
}
subtask("staked-snap", "Dumps a user's staking token details.")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("user", "Address or contract name of user", undefined, types.string)
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)

        const userAddress = resolveAddress(taskArgs.user, chain)

        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)

        const block = await getBlock(hre.ethers, taskArgs.block)
        const callOverride = {
            blockTag: block.blockNumber,
        }

        const [rawBalance, cooldownBalance] = await stakingToken.rawBalanceOf(userAddress, callOverride)
        const boostedBalance = await stakingToken.balanceOf(userAddress, callOverride)
        const votes = await stakingToken.getVotes(userAddress, callOverride)
        const delegatedVotes = votes.sub(boostedBalance)
        const effectiveMultiplier = rawBalance.gt(0) ? boostedBalance.mul(10000).div(rawBalance) : BN.from(0)
        const delegatee = await stakingToken.delegates(userAddress, callOverride)
        const priceCoeff = taskArgs.asset === "MTA" ? BN.from(10000) : await stakingToken.priceCoefficient()
        const earnedRewards = await stakingToken.earned(userAddress, callOverride)

        console.log(`Raw balance          ${usdFormatter(rawBalance)}`)
        console.log(`Boosted balance      ${usdFormatter(boostedBalance)}`)
        console.log(`Delegated votes      ${usdFormatter(delegatedVotes)}`)
        console.log(`Cooldown balance     ${usdFormatter(cooldownBalance)}`)
        console.log(`Voting power         ${usdFormatter(votes)}`)
        console.log(`Earned Rewards       ${usdFormatter(earnedRewards)}`)

        const balanceData = await stakingToken.balanceData(userAddress, callOverride)

        // Multipliers
        console.log("\nMultipliers")
        console.log(`Time                  ${formatUnits(balanceData.timeMultiplier + 100, 2)}`)
        console.log(`Quest                 ${formatUnits(balanceData.questMultiplier + 100, 2)}`)
        console.log(`MTA Price coefficient ${formatUnits(priceCoeff, 4)}`)
        console.log(`Effective multiplier  ${formatUnits(effectiveMultiplier, 4)}`)

        if (balanceData.cooldownTimestamp > 0) {
            const cooldownEnds = balanceData.cooldownTimestamp + ONE_WEEK.mul(3).toNumber()
            console.log(`\nCooldown ends ${new Date(cooldownEnds * 1000)}`)
            console.log(`Cooldown units ${usdFormatter(balanceData.cooldownUnits)}`)
        }

        console.log(`\nDelegatee ${delegatee}`)
    })
task("staked-snap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-stake", "Stake MTA or mBPT in V2 Staking Token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("amount", "Amount of tokens to be staked without the token decimals.", undefined, types.float)
    .addParam("delegate", "Address or contract name the voting power will be delegated to.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const stakeAmount = simpleToExactAmount(taskArgs.amount)
        let tx
        if (taskArgs.delegate) {
            const delegateAddress = resolveAddress(taskArgs.delegate, chain)
            tx = await stakingToken["stake(uint256,address)"](stakeAmount, delegateAddress)
        } else {
            tx = await stakingToken["stake(uint256)"](stakeAmount)
        }
        await logTxDetails(tx, `Stake ${taskArgs.amount} ${taskArgs.symbol}`)
    })
task("staked-stake").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-cooldown-start", "Start cooldown of V2 staking token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("amount", "Amount to of token to be staked without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const cooldownAmount = simpleToExactAmount(taskArgs.amount)
        const tx = await stakingToken.startCooldown(cooldownAmount)

        await logTxDetails(tx, `Start cooldown for ${taskArgs.amount} ${taskArgs.asset} tokens`)
    })
task("staked-cooldown-start").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-cooldown-end", "End cooldown of V2 staking token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const tx = await stakingToken.endCooldown()

        await logTxDetails(tx, `End cooldown for ${taskArgs.asset} tokens`)
    })
task("staked-cooldown-end").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-withdraw", "Withdraw MTA or mBPT in V2 Staking Token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("amount", "Amount to of token to be staked without the token decimals.", undefined, types.float)
    .addOptionalParam("recipient", "Address or contract name that will receive the withdrawn tokens.", undefined, types.string)
    .addOptionalParam(
        "fee",
        "True if withdraw fee to be taken from the amount. False if received amount to equal with withdraw amount.",
        true,
        types.boolean,
    )
    .addOptionalParam(
        "cooldown",
        "False if not exiting from a previous cooldown. True if previous cooldown to be ended.",
        false,
        types.boolean,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const withdrawAmount = simpleToExactAmount(taskArgs.amount)
        const recipientAddress = taskArgs.recipient ? resolveAddress(taskArgs.recipient, chain) : await signer.getAddress()
        const tx = await stakingToken.withdraw(withdrawAmount, recipientAddress, taskArgs.fee, taskArgs.fee)
        await logTxDetails(tx, `Withdraw ${taskArgs.amount} ${taskArgs.symbol}`)
    })
task("staked-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-claim", "Claim MTA rewards from V2 staking token")
    .addOptionalParam("recipient", "Address or contract name that will receive the MTA rewards.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("MTA", chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        let tx
        if (taskArgs.recipient) {
            const recipientAddress = taskArgs.recipient ? resolveAddress(taskArgs.recipient, chain) : await signer.getAddress()
            tx = await stakingToken["claimReward(address)"](recipientAddress)
        } else {
            tx = await stakingToken["claimReward()"]()
        }
        const receipt = await logTxDetails(tx, `Claim earned MTA rewards`)
        console.log(`Claimed ${formatUnits(receipt.events[0].args[2])} MTA rewards`)
    })
task("staked-claim").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-compound", "Stake any earned MTA rewards")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("MTA", chain, "vault")
        const stakingToken = StakedTokenMTA__factory.connect(stakingTokenAddress, signer)
        const tx = await stakingToken.compoundRewards()
        const receipt = await logTxDetails(tx, "Stake earned MTA rewards")
        console.log(`Staked ${formatUnits(receipt.events[0].args[2])} MTA rewards`)
    })
task("staked-compound").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-delegate", "Delegate V2 Staking Tokens")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("delegate", "Address or contract name the voting power will be delegated to.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const delegateAddress = resolveAddress(taskArgs.delegate, chain)
        const tx = await stakingToken.delegate(delegateAddress)
        await logTxDetails(tx, `Delegate voting power to ${taskArgs.delegate}`)
    })
task("staked-delegate").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-update-price-coeff", "Updates the price coefficient on the staked mBPT Token.")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("mBPT", chain, "vault")
        const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)
        const tx = await stakingToken.fetchPriceCoefficient()
        await logTxDetails(tx, `update price coefficient`)
    })
task("staked-update-price-coeff").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-price-coeff", "Checks the price coefficient on the staked mBPT Token.").setAction(async (taskArgs, hre) => {
    const signer = await getSigner(hre)
    const chain = getChain(hre)

    const stakingTokenAddress = resolveAddress("mBPT", chain, "vault")
    const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)
    const oldPrice = (await stakingToken.priceCoefficient()).toNumber()
    const newPrice = (await stakingToken.getProspectivePriceCoefficient()).toNumber()
    const diffPercentage = ((newPrice - oldPrice) * 100) / oldPrice
    console.log(`Old price ${oldPrice}, new price, diff ${newPrice} ${diffPercentage}%`)
})
task("staked-price-coeff").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-fees", "Converts fees accrued in BPT to MTA, before depositing to the rewards contract.")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("mBPT", chain, "vault")
        const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)

        const feesBPT = await stakingToken.pendingBPTFees()
        if (feesBPT.lt(simpleToExactAmount(100))) {
            console.log(`Only ${feesBPT} mBPT in fees so will not convert to MTA`)
            return
        }
        const tx = await stakingToken.convertFees()
        await logTxDetails(tx, `convert mBPT to fees`)
    })
task("staked-fees").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-time", "Updates a user's time multiplier.")
    .addParam("user", "Address or contract name of users, separated by ',' ", undefined, types.string)
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)
        console.log(`staked-time user ${taskArgs.user} asset ${taskArgs.asset} speed ${taskArgs.speed}`)
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const users = taskArgs.user.split(",");
        let totalTxCost = BN.from(0)
        let progress = BATCH_SIZE > users.length ? users.length : BATCH_SIZE
        let promises = []
        const reviewTimestamp = async (accountAddress: string): Promise<BN> => {
            const tx = await stakingToken.reviewTimestamp(accountAddress)
            const receipt = await logTxDetails(tx, `update time multiplier for ${accountAddress}`)
            return receipt.gasUsed.mul(tx.gasPrice ?? 0)
        }

        for (let i = 0; i < users.length; i++) {
            promises.push(reviewTimestamp(users[i]))
            if (progress < i || i === users.length - 1) {
                console.log(`staked-time:: executing ${progress} out of ${users.length}`, new Date())
                progress = progress + BATCH_SIZE > users.length ? users.length : progress + BATCH_SIZE
                // eslint-disable-next-line no-await-in-loop
                totalTxCost = totalTxCost.add((await Promise.all(promises)).reduce((a, b) => a.add(b)))
                promises = [] // clean buffer of promises
            }
        }
        console.log(`staked-time:: Time multiplier updated for  ${users.length} accounts, total gas ${formatUnits(totalTxCost)} Gwei`)
    })
task("staked-time").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-time-all-users", "Updates all user's time multiplier.")
    .addOptionalParam("assets", "Symbol of staking token. MTA or mBPT", "MTA,mBPT", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed, false)

        const stakingTokens = taskArgs.assets.split(",")
        const startDate = new Date()
        console.log(`staked-time-all-user:: assets: ${taskArgs.assets} stakingTokens: ${stakingTokens} ${stakingTokens.length}  startDate: ${startDate}`)
        const allStakers = await fetchAllStakers()
        // for each stakingTokens call staked-time
        for (let i = 0; i < stakingTokens.length; i++) {
            const stakingTokenAddress = resolveAddress(stakingTokens[i], chain, "vault")
            console.log(`staked-time:: stakingTokens: ${stakingTokens[i]} chain:${chain} stakingTokenAddress:${stakingTokenAddress}`)
            let accounts = filterAccountsByStakingToken(allStakers, stakingTokenAddress.toLowerCase())
            // eslint-disable-next-line no-await-in-loop
            accounts = await filterAccountsTimeMultiplier(accounts, stakingTokenAddress, signer)
            if (accounts.length > 0) {
                // eslint-disable-next-line no-await-in-loop
                await hre.run("staked-time",
                    {
                        user: accounts.join(","),
                        asset: stakingTokens[i],
                        speed: taskArgs.speed
                    });
            }
        }
        const endDate = new Date()
        const diff = ((endDate.getTime() - startDate.getTime()) / 1000) / 60;

        console.log(`staked-time-all-user:: startDate: ${startDate}, endDate: ${endDate}, process time: ${Math.abs(Math.round(diff))}`)
    })
task("staked-time-all-users").setAction(async (_, __, runSuper) => {
    await runSuper()
})