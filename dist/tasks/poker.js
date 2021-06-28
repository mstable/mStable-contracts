"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
const units_1 = require("@ethersproject/units");
const constants_1 = require("@utils/constants");
const math_1 = require("@utils/math");
const ethers_multicall_1 = require("ethers-multicall");
const graphql_request_1 = require("graphql-request");
const config_1 = require("hardhat/config");
const generated_1 = require("types/generated");
const defender_utils_1 = require("./utils/defender-utils");
const deploy_utils_1 = require("./utils/deploy-utils");
const tokens_1 = require("./utils/tokens");
const maxVMTA = math_1.simpleToExactAmount(300000, 18);
const maxBoost = math_1.simpleToExactAmount(4, 18);
const minBoost = math_1.simpleToExactAmount(1, 18);
const floor = math_1.simpleToExactAmount(95, 16);
const pokerAddress = "0x8E1Fd7F5ea7f7760a83222d3d470dFBf8493A03F";
const calcBoost = (raw, vMTA, priceCoefficient, boostCoeff, decimals = 18) => {
    // min(m, max(d, (d * 0.95) + c * min(vMTA, f) / USD^b))
    const scaledBalance = raw.mul(priceCoefficient).div(math_1.simpleToExactAmount(1, decimals));
    if (scaledBalance.lt(math_1.simpleToExactAmount(1, decimals)))
        return minBoost;
    let denom = parseFloat(units_1.formatUnits(scaledBalance));
    denom **= 0.875;
    const flooredMTA = vMTA.gt(maxVMTA) ? maxVMTA : vMTA;
    let rhs = floor.add(flooredMTA.mul(boostCoeff).div(10).mul(constants_1.fullScale).div(math_1.simpleToExactAmount(denom)));
    rhs = rhs.gt(minBoost) ? rhs : minBoost;
    return rhs.gt(maxBoost) ? maxBoost : rhs;
};
const getAccountBalanceMap = async (accounts, tokenAddress, signer) => {
    const abi = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];
    const token = new ethers_multicall_1.Contract(tokenAddress, abi);
    const ethcallProvider = new ethers_multicall_1.Provider(signer.provider);
    await ethcallProvider.init();
    const callPromises = accounts.map((account) => token.balanceOf(account));
    console.log(`About to get vMTA balances for ${accounts.length} accounts`);
    const balances = (await ethcallProvider.all(callPromises));
    const accountBalances = {};
    balances.forEach((balance, i) => {
        accountBalances[accounts[i]] = balance;
    });
    return accountBalances;
};
config_1.task("over-boost", "Pokes accounts that are over boosted")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", config_1.types.string)
    .addFlag("update", "Will send a poke transactions to the Poker contract")
    .addOptionalParam("minMtaDiff", "Min amount of vMTA over boosted", 500, config_1.types.int)
    .setAction(async (taskArgs, hre) => {
    const minMtaDiff = math_1.simpleToExactAmount(taskArgs.minMtaDiff);
    const signer = await defender_utils_1.getSigner(hre.network.name, hre.ethers, taskArgs.speed);
    // const signer = await impersonate("0x2f2Db75C5276481E2B018Ac03e968af7763Ed118")
    const gqlClient = new graphql_request_1.GraphQLClient("https://api.thegraph.com/subgraphs/name/mstable/mstable-feeder-pools");
    const query = graphql_request_1.gql `
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
                _meta {
                    block {
                        number
                    }
                }
            }
        `;
    const gqlData = await gqlClient.request(query);
    // eslint-disable-next-line no-underscore-dangle
    const blockNumber = gqlData._meta.block.number;
    console.log(`Results for block number ${blockNumber}`);
    // Maps GQL to a list if accounts (addresses) in each vault
    const vaultAccounts = gqlData.boostedSavingsVaults.map((vault) => vault.accounts.map((account) => account.account.id));
    const accountsWithDuplicates = vaultAccounts.flat();
    const accountsUnique = [...new Set(accountsWithDuplicates)];
    const vMtaBalancesMap = await getAccountBalanceMap(accountsUnique, tokens_1.MTA.vault, signer);
    const pokeVaultAccounts = [];
    // For each Boosted Vault
    for (const vault of gqlData.boostedSavingsVaults) {
        const boostVault = generated_1.BoostedSavingsVault__factory.connect(vault.id, signer);
        const priceCoeff = await boostVault.priceCoeff();
        const boostCoeff = await boostVault.boostCoeff();
        const overBoosted = [];
        console.log(`\nVault with id ${vault.id} for token ${vault.stakingToken.symbol}, ${vault.accounts.length} accounts, price coeff ${priceCoeff}, boost coeff ${boostCoeff}`);
        console.log("Account, Raw Balance, Boosted Balance, Boost Balance USD, vMTA balance, Boost Actual, Boost Expected, Boost Diff");
        // For each account in the boosted savings vault
        vault.accounts.forEach((account) => {
            const boostActual = math_1.BN.from(account.boostedBalance).mul(1000).div(account.rawBalance).toNumber();
            const boostExpected = calcBoost(math_1.BN.from(account.rawBalance), vMtaBalancesMap[account.account.id], priceCoeff, boostCoeff)
                .div(math_1.simpleToExactAmount(1, 15))
                .toNumber();
            const boostDiff = boostActual - boostExpected;
            // Calculate how much the boost balance is in USD = balance balance * price coefficient / 1e18
            const boostBalanceUsd = math_1.BN.from(account.boostedBalance).mul(priceCoeff).div(math_1.simpleToExactAmount(1));
            // Identify accounts with more than 20% over their boost and boost balance > 50,000 USD
            if (boostDiff > 200 && boostBalanceUsd.gt(math_1.simpleToExactAmount(50000))) {
                overBoosted.push({
                    ...account,
                    boostActual,
                    boostExpected,
                    boostDiff,
                    boostBalanceUsd,
                });
            }
            console.log(`${account.account.id}, ${units_1.formatUnits(account.rawBalance)}, ${units_1.formatUnits(account.boostedBalance)}, ${units_1.formatUnits(boostBalanceUsd)}, ${units_1.formatUnits(vMtaBalancesMap[account.account.id])}, ${units_1.formatUnits(boostActual, 3)}, ${units_1.formatUnits(boostExpected, 3)}, ${units_1.formatUnits(boostDiff, 3)}`);
        });
        console.log(`${overBoosted.length} of ${vault.accounts.length} over boosted for ${vault.id}`);
        overBoosted.forEach((account) => {
            console.log(`${account.account.id} ${units_1.formatUnits(account.boostDiff, 3)}, ${units_1.formatUnits(account.boostBalanceUsd)}`);
        });
        const pokeAccounts = overBoosted.map((account) => account.account.id);
        console.log(pokeAccounts);
        pokeVaultAccounts.push({
            boostVault: vault.id,
            accounts: pokeAccounts,
        });
    }
    if (taskArgs.update) {
        const poker = generated_1.Poker__factory.connect(pokerAddress, signer);
        const tx = await poker.poke(pokeVaultAccounts);
        await deploy_utils_1.logTxDetails(tx, "poke Poker");
    }
});
config_1.task("deployPoker", "Deploys the Poker contract").setAction(async (_, hre) => {
    const deployer = await defender_utils_1.getSigner(hre.network.name, hre.ethers);
    await deploy_utils_1.deployContract(new generated_1.Poker__factory(deployer), "Poker");
});
module.exports = {};
//# sourceMappingURL=poker.js.map