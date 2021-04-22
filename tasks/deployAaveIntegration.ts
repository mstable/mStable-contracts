import "ts-node/register"
import "tsconfig-paths/register"

import { task } from "hardhat/config"
import { AaveV2Integration__factory } from "types/generated"
import { DEAD_ADDRESS } from "@utils/constants"

interface CommonAddresses {
    nexus: string
    mAsset: string
    aave: string
    aaveToken: string
}

task("deployAaveIntegration", "Deploys an instance of AaveV2Integration contract").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const [deployer] = await ethers.getSigners()

    if (network.name !== "mainnet") throw Error("Invalid network")

    const addresses: CommonAddresses = {
        mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
        nexus: "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3",
        aave: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
        aaveToken: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    }

    // Deploy
    const impl = await new AaveV2Integration__factory(deployer).deploy(
        addresses.nexus,
        addresses.mAsset,
        addresses.aave,
        addresses.aaveToken,
    )
    const reciept = await impl.deployTransaction.wait()
    console.log(`Deployed Integration to ${impl.address}. gas used ${reciept.gasUsed}`)

    // Complete setup
    //  - Set pToken addresses via governance
})

module.exports = {}
