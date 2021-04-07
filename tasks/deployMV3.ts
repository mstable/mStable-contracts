import "ts-node/register"
import "tsconfig-paths/register"

import { task } from "hardhat/config"
import { MusdV3__factory } from "types/generated"
import { DEAD_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"

const defaultConfig = {
    a: 120,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(65, 16),
    },
}

task("deployMV3", "Deploys the mUSD V3 implementation").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const [deployer] = await ethers.getSigners()

    const nexus = network.name === "mainnet" ? "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3" : DEAD_ADDRESS

    const Manager = await ethers.getContractFactory("Manager")
    const managerLib = await Manager.deploy()
    await managerLib.deployTransaction.wait()
    const Migrator = await ethers.getContractFactory("Migrator")
    const migratorLib = await Migrator.deploy()
    await migratorLib.deployTransaction.wait()

    const linkedAddress = {
        __$4ff61640dcfbdf6af5752b96f9de1a9efe$__: migratorLib.address,
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: managerLib.address,
    }
    // Implementation
    const massetFactory = new MusdV3__factory(linkedAddress, deployer)
    const size = massetFactory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`Masset size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`Masset = ${size} kb`)
    }
    const impl = await massetFactory.deploy(nexus)
    const receiptImpl = await impl.deployTransaction.wait()
    console.log(`Deployed to ${impl.address}. gas used ${receiptImpl.gasUsed}`)

    const Validator = await ethers.getContractFactory("InvariantValidator")
    const validator = await Validator.deploy()
    await validator.deployTransaction.wait()
    const data = await impl.interface.encodeFunctionData("upgrade", [validator.address, defaultConfig])
    console.log(`Upgrade data:\n\n${data}\n\n`)
})

module.exports = {}
