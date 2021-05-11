import { Speed } from "defender-relay-client"
import { Signer } from "ethers"
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers"

export const getDefenderSigner = async (speed: Speed = "average"): Promise<Signer> => {
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
