import { Speed } from "defender-relay-client"
import { Signer, Wallet } from "ethers"
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers"
import { impersonate } from "@utils/fork"
import { ethereumAddress } from "@utils/regex"
import { Account } from "types"
import { getChain, getChainAddress, HardhatRuntime, resolveAddress } from "./networkAddressFactory"

export const getDefenderSigner = async (speed: Speed = "fast"): Promise<Signer> => {
    if (!process.env.DEFENDER_API_KEY || !process.env.DEFENDER_API_SECRET) {
        console.error(`Defender env vars DEFENDER_API_KEY and/or DEFENDER_API_SECRET have not been set`)
        process.exit(1)
    }
    if (!["safeLow", "average", "fast", "fastest"].includes(speed)) {
        console.error(`Defender Relay Speed param must be either 'safeLow', 'average', 'fast' or 'fastest'. Not "${speed}"`)
        process.exit(2)
    }
    const credentials = {
        apiKey: process.env.DEFENDER_API_KEY,
        apiSecret: process.env.DEFENDER_API_SECRET,
    }
    const provider = new DefenderRelayProvider(credentials)
    const signer = new DefenderRelaySigner(credentials, provider, { speed })
    return signer
}

export const getSigner = async (hre: HardhatRuntime = {}, speed: Speed = "fast"): Promise<Signer> => {
    // If connecting to a forked chain
    if (["tasks-fork.config.ts", "tasks-fork-polygon.config.ts"].includes(hre?.hardhatArguments.config)) {
        const chain = getChain(hre)
        // If IMPERSONATE environment variable has been set
        if (process.env.IMPERSONATE) {
            let address = process.env.IMPERSONATE
            if (!address.match(ethereumAddress)) {
                address = resolveAddress(process.env.IMPERSONATE, chain)
                if (!address) throw Error(`Environment variable IMPERSONATE is an invalid Ethereum address or contract name`)
            }
            console.log(`Impersonating account ${address}`)
            return impersonate(address)
        }
        const address = getChainAddress("OperationsSigner", chain)
        if (address) {
            console.log(`Impersonating account ${address}`)
            return impersonate(address)
        }
        // Return a random account with no Ether
        return Wallet.createRandom().connect(hre.ethers.provider)
    }
    // If using Defender Relay and not a forked chain
    // this will work against test networks like Ropsten or Polygon's Mumbai
    if (process.env.DEFENDER_API_KEY && process.env.DEFENDER_API_SECRET) {
        return getDefenderSigner(speed)
    }

    // Return a random account with no Ether.
    // This is typically used for readonly tasks. eg reports
    return Wallet.createRandom().connect(hre.ethers.provider)
}

export const getSignerAccount = async (hre: HardhatRuntime = {}, speed: Speed = "fast"): Promise<Account> => {
    const signer = await getSigner(hre, speed)
    return {
        signer,
        address: await signer.getAddress(),
    }
}
