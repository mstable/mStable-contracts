import { Speed } from "defender-relay-client"
import { Signer, Wallet } from "ethers"
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers"
import { impersonate } from "@utils/fork"
import { ethereumAddress, privateKey } from "@utils/regex"
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

let signerInstance: Signer

export const getSigner = async (hre: HardhatRuntime = {}, speed: Speed = "fast", useCache = true, key?: string): Promise<Signer> => {
    // If already initiated a signer, just return the singleton instance
    if (useCache && signerInstance) return signerInstance

    const pk = key || process.env.PRIVATE_KEY
    if (pk) {
        if (!pk.match(privateKey)) {
            throw Error(`Invalid format of private key`)
        }
        const wallet = new Wallet(pk, hre.ethers.provider)
        console.log(`Using signer ${await wallet.getAddress()} from private key`)
        return wallet
    }

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
            console.log(`Impersonating account ${address} from IMPERSONATE environment variable`)
            signerInstance = await impersonate(address)
            return signerInstance
        }
        const address = getChainAddress("OperationsSigner", chain)
        if (address) {
            console.log(`Impersonating account ${address} resolved from "OperationsSigner"`)
            signerInstance = await impersonate(address)
            return signerInstance
        }
        // Return a random account with no Ether
        signerInstance = Wallet.createRandom().connect(hre.ethers.provider)
        console.log(`Impersonating random account ${await signerInstance.getAddress()}`)
        return signerInstance
    }
    // If using Defender Relay and not a forked chain
    // this will work against test networks like Ropsten or Polygon's Mumbai
    if (process.env.DEFENDER_API_KEY && process.env.DEFENDER_API_SECRET) {
        signerInstance = await getDefenderSigner(speed)
        return signerInstance
    }

    // Return a random account with no Ether.
    // This is typically used for readonly tasks. eg reports
    signerInstance = Wallet.createRandom().connect(hre.ethers.provider)
    return signerInstance
}

export const getSignerAccount = async (hre: HardhatRuntime = {}, speed: Speed = "fast"): Promise<Account> => {
    const signer = await getSigner(hre, speed)
    return {
        signer,
        address: await signer.getAddress(),
    }
}
