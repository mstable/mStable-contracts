/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"

import { task } from "hardhat/config"
import { Nexus__factory } from "types/generated"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { utils } from "ethers"

const deployNexus = async (deployer: SignerWithAddress) => {
    // Deploy Nexus
    console.log(`Deploying Nexus Contract`)
    const nexus = await new Nexus__factory(deployer).deploy(deployer.address)
    const nexusReceipt = await nexus.deployTransaction.wait()
    console.log(`Deployed Nexus contract to ${nexus.address}. gas used ${nexusReceipt.gasUsed}`)

    // Initialize
    // const KEY_PROXY_ADMIN = utils.keccak256("ProxyAdmin")
    // await nexus.initialize([], [], [], deployer.address)
}

task("deploy-polly", "Deploys mUSD, mBTC and Feeder pools to a Polygon network").setAction(async (_, hre) => {
    const { ethers, network } = hre
    // if (network.name !== "mamumbai-testnet") throw Error("Must be Polygon testnet mumbai-testnet")

    const [deployer] = await ethers.getSigners()

    await deployNexus(deployer)
})

module.exports = {}
