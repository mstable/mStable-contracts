import { impersonateAccount } from "@utils/fork"
import { ethers, network } from "hardhat"
import { Account, ERC20 } from "types"

import { getMainnetSdk } from "@dethcrypto/eth-sdk-client"

import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { ONE_HOUR, ONE_WEEK, ZERO_ADDRESS, MAX_UINT256, DEAD_ADDRESS } from "@utils/constants"

import { resolveAddress, resolveToken } from "tasks/utils/networkAddressFactory"

import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import { Contract } from "ethers"

const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const assetManagementSubDAOAddress = "0x67905d3e4fec0C85dCe68195F66Dc8eb32F59179"

const toEther = (amount: BN) => ethers.utils.formatEther(amount)

context("Withdraw test", async () => {
    let assetManagementSubDAO: Account
    let ethWhale: Account
    let balPool: Contract

    let sdk

    const runSetup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })

        assetManagementSubDAO = await impersonateAccount(assetManagementSubDAOAddress)
        ethWhale = await impersonateAccount(ethWhaleAddress)

        const mainnetProvider = ethers.getDefaultProvider("mainnet")
        const defaultSigner = ethers.Wallet.createRandom().connect(mainnetProvider)

        sdk = getMainnetSdk(defaultSigner) // default signer will be wired with all contract instances
        // sdk is an object like { dai: DaiContract }

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.signer.sendTransaction({
            to: assetManagementSubDAO.address,
            value: simpleToExactAmount(5),
        })
    }

    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
    })

    describe("Remove liquidity", async () => {
        before("reset block number", async () => {
            await runSetup(14179191)
        })
        it("Send tx", async () => {
            const balance = sdk.mBPT.connect(assetManagementSubDAO).balanceOf(assetManagementSubDAO.address)
            console.log(`Balance of ${assetManagementSubDAO.address} is ${toEther(balance)}`)
        })
    })
})
