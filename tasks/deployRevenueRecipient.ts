/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"

import { DEAD_ADDRESS } from "@utils/constants"
import { task } from "hardhat/config"
import { RevenueRecipient__factory } from "types/generated"
import { simpleToExactAmount, BN } from "@utils/math"

interface CommonAddresses {
    mAssets: string[]
    minOuts: BN[]
    nexus: string
    bPool: string
}

task("deployRevenueRecipient", "Deploys an instance of revenue recipient contract").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const [deployer] = await ethers.getSigners()

    if (network.name !== "mainnet" && network.name !== "ropsten") throw Error("Invalid network")

    const addresses: CommonAddresses =
        network.name === "ropsten"
            ? {
                  mAssets: ["0x4E1000616990D83e56f4b5fC6CC8602DcfD20459", "0x4A677A48A790f26eac4c97f495E537558Abf6A79"],
                  minOuts: [],
                  nexus: "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB",
                  bPool: DEAD_ADDRESS,
              }
            : {
                  mAssets: ["0xe2f2a5C287993345a840Db3B0845fbC70f5935a5", "0x945Facb997494CC2570096c74b5F66A3507330a1"],
                  minOuts: [simpleToExactAmount(1, 18), simpleToExactAmount(1, 18)], // TODO - add this
                  nexus: "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3",
                  bPool: DEAD_ADDRESS, // TODO - add this
              }

    // Deploy
    const recipient = await new RevenueRecipient__factory(deployer).deploy(
        addresses.nexus,
        addresses.bPool,
        addresses.mAssets,
        addresses.minOuts,
    )
    const reciept = await recipient.deployTransaction.wait()
    console.log(`Deployed Recipient to ${recipient.address}. gas used ${reciept.gasUsed}`)

    // Complete setup
    //  - Update SavingsRate in SavingsManager
    //  - Add RevenueRecipient address in SavingsManager
})

module.exports = {}
