import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { GaugeBriber__factory, ERC20__factory, SavingsManager__factory } from "types/generated"
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

task("briber-forward")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        // LOAD
        const savingsManagerAddr = resolveAddress("SavingsManager", chain)
        const musdAddr = resolveAddress("mUSD", chain, "address")
        const recipientAddr = "0x8f2A9Ce873AEBd7a212A942B12b2209Fa00831D2"
        const briber = "0xd0f0F590585384AF7AB420bE1CFB3A3F8a82D775"

        const savingsManager = SavingsManager__factory.connect(savingsManagerAddr, signer)
        const musd = ERC20__factory.connect(musdAddr, signer)
        const recipient = GaugeBriber__factory.connect(recipientAddr, signer)

        // EXEC
        const bal0 = await musd.balanceOf(briber)
        console.log(bal0.toString())
        // 1. Forward
        let tx = await savingsManager.distributeUnallocatedInterest(musdAddr)
        await tx.wait(2)
        // 2. Distribute
        tx = await recipient.forward()
        await tx.wait(2)

        // CHECK
        const bal1 = await musd.balanceOf(briber)
        console.log(bal1.toString())
    })

module.exports = {}
