import "ts-node/register"
import "tsconfig-paths/register"

import { ONE_WEEK } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { task, types } from "hardhat/config"
import { SavingsManager__factory } from "types/generated"

import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

task("deploy-SavingsManager")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexus = resolveAddress("Nexus", chain)
        const revenueRecipient = resolveAddress("RevenueRecipient", chain)

        const musd = resolveAddress("mUSD", chain, "address")
        const musdSave = resolveAddress("mUSD", chain, "savings")
        const mbtc = resolveAddress("mBTC", chain, "address")
        const mbtcSave = resolveAddress("mBTC", chain, "savings")

        const savingsManager = await deployContract(new SavingsManager__factory(signer), "SavingsManager", [
            nexus,
            [musd, mbtc],
            [musdSave, mbtcSave],
            [revenueRecipient, revenueRecipient],
            simpleToExactAmount(9, 17),
            ONE_WEEK,
        ])

        await verifyEtherscan(hre, {
            address: savingsManager.address,
            contract: "contracts/savings/SavingsManager.sol:SavingsManager",
        })
    })

module.exports = {}
