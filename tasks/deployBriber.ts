import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { GaugeBriber__factory } from "types/generated"
import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

task("deploy-GaugeBriber")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexus = resolveAddress("Nexus", chain)
        const musd = resolveAddress("mUSD", chain, "address")
        const keeper = "0xb81473f20818225302b8fffb905b53d58a793d84"
        const briber = "0xd0f0F590585384AF7AB420bE1CFB3A3F8a82D775"
        const childRecipient = resolveAddress("RevenueRecipient", chain)

        const gaugeBriber = await deployContract(new GaugeBriber__factory(signer), "GaugeBriber", [
            nexus,
            musd,
            keeper,
            briber,
            childRecipient,
        ])

        await verifyEtherscan(hre, {
            address: gaugeBriber.address,
            contract: "contracts/buy-and-make/GaugeBriber.sol:GaugeBriber",
        })
    })

module.exports = {}
