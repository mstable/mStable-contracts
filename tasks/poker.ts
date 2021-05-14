import { formatUnits } from "@ethersproject/units"
import { fullScale } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { Signer } from "ethers"
import { Contract, Provider } from "ethers-multicall"
import { gql, GraphQLClient } from "graphql-request"
import { task, types } from "hardhat/config"
import { getDefenderSigner } from "./utils/defender-utils"
import { logTxDetails } from "./utils/deploy-utils"
import { MTA } from "./utils/tokens"

const maxVMTA = simpleToExactAmount(300000, 18)
const maxBoost = simpleToExactAmount(4, 18)
const minBoost = simpleToExactAmount(1, 18)
const floor = simpleToExactAmount(95, 16)
const coeff = BN.from(45)
const priceCoeff = simpleToExactAmount(1, 17)

const calcBoost = (raw: BN, vMTA: BN, priceCoefficient = priceCoeff, decimals = 18): BN => {
    // min(m, max(d, (d * 0.95) + c * min(vMTA, f) / USD^b))
    const scaledBalance = raw.mul(priceCoefficient).div(simpleToExactAmount(1, decimals))

    if (scaledBalance.lt(simpleToExactAmount(1, decimals))) return minBoost

    let denom = parseFloat(formatUnits(scaledBalance))
    denom **= 0.875
    const flooredMTA = vMTA.gt(maxVMTA) ? maxVMTA : vMTA
    let rhs = floor.add(flooredMTA.mul(coeff).div(10).mul(fullScale).div(simpleToExactAmount(denom)))
    rhs = rhs.gt(minBoost) ? rhs : minBoost
    return rhs.gt(maxBoost) ? maxBoost : rhs
}

type AccountBalance = { [index: string]: BN }
const getAccountBalanceMap = async (accounts: string[], tokenAddress: string, signer: Signer): Promise<AccountBalance> => {
    const abi = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"]
    const token = new Contract(tokenAddress, abi)

    const ethcallProvider = new Provider(signer.provider)
    await ethcallProvider.init()

    const callPromises = accounts.map((account) => token.balanceOf(account))

    console.log(`About to get vMTA balances for ${accounts.length} accounts`)
    const balances = (await ethcallProvider.all(callPromises)) as BN[]
    const accountBalances: AccountBalance = {}
    balances.forEach((balance, i) => {
        accountBalances[accounts[i]] = balance
    })
    return accountBalances
}

task("over-boost", "Pokes accounts that are over boosted")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs) => {
        const signer = await getDefenderSigner(taskArgs.speed)

        const gqlClient = new GraphQLClient("https://api.thegraph.com/subgraphs/name/mstable/mstable-feeder-pools")

        const query = gql`
            {
                boostedSavingsVaults {
                    id
                    boostCoeff
                    priceCoeff
                    stakingToken {
                        symbol
                    }
                    accounts(where: { rawBalance_gt: "0" }) {
                        account {
                            id
                        }
                        rawBalance
                        boostedBalance
                        rewardPerTokenPaid
                        rewards
                        lastClaim
                        lastAction
                    }
                }
            }
        `
        const gqlData = await gqlClient.request(query)

        // Maps GQL to a list if accounts (addresses) in each vault
        const vaultAccounts = gqlData.boostedSavingsVaults.map((vault) => vault.accounts.map((account) => account.account.id))
        const accountsWithDuplicates = vaultAccounts.flat()
        const accountsUnique = [...new Set<string>(accountsWithDuplicates)]

        const vMtcBalancesMap = await getAccountBalanceMap(accountsUnique, MTA.saving, signer)

        // For each Boosted Vault
        gqlData.boostedSavingsVaults.forEach((vault) => {
            console.log(`\nVault with id ${vault.id} for token ${vault.stakingToken.symbol}, ${vault.accounts.length} accounts`)
            console.log("Account, Raw Balance, Boosted Balance, rewardPerTokenPaid, boost, vMTA balance")

            vault.accounts.forEach((account, i) => {
                const boost = calcBoost(BN.from(account.rawBalance), vMtcBalancesMap[account.account.id])
                console.log(
                    `${account.account.id}, ${formatUnits(account.rawBalance)}, ${formatUnits(account.boostedBalance)}, ${formatUnits(
                        account.rewardPerTokenPaid,
                    )}, ${formatUnits(boost)}, ${formatUnits(vMtcBalancesMap[account.account.id])}`,
                )
            })
        })
    })

module.exports = {}
