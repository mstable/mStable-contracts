import { subtask, task, types } from "hardhat/config"

import { impersonate } from "@utils/fork"
import { IERC20, IERC20__factory } from "types"
import { simpleToExactAmount } from "@utils/math"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

const mtaWhaleAddress = "0x3dd46846eed8D147841AE162C8425c08BD8E1b41"

let mtaToken: IERC20

subtask("prepareAccount", "Prepares an Accounts for a local hardhat node for testing.")
    .addParam("address", "Address to prepare", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await hre.ethers.getSigners()[0]
        const account = taskArgs.address
        const chain = getChain(hre)

        mtaToken = IERC20__factory.connect(resolveAddress("MTA", chain), signer)

        const mtaWhale = await impersonate(mtaWhaleAddress)

        // Send MTA to address from the mtaWhale account
        await mtaToken.connect(mtaWhale).transfer(account, simpleToExactAmount(1000))
    })

task("prepareAccount").setAction(async (_, __, runSuper) => {
    await runSuper()
})
