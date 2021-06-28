"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSigner = exports.getDefenderSigner = void 0;
const ethers_1 = require("defender-relay-client/lib/ethers");
const getDefenderSigner = async (speed = "fast") => {
    if (!process.env.DEFENDER_API_KEY || !process.env.DEFENDER_API_SECRET) {
        console.error(`Defender env vars DEFENDER_API_KEY and/or DEFENDER_API_SECRET have not been set`);
        process.exit(1);
    }
    if (!["safeLow", "average", "fast", "fastest"].includes(speed)) {
        console.error(`Defender Relay Speed param must be either 'safeLow', 'average', 'fast' or 'fastest'. Not "${speed}"`);
        process.exit(2);
    }
    const credentials = {
        apiKey: process.env.DEFENDER_API_KEY,
        apiSecret: process.env.DEFENDER_API_SECRET,
    };
    const provider = new ethers_1.DefenderRelayProvider(credentials);
    const signer = new ethers_1.DefenderRelaySigner(credentials, provider, { speed });
    return signer;
};
exports.getDefenderSigner = getDefenderSigner;
const getSigner = async (networkName, ethers, speed = "fast") => ["mainnet", "polygon_mainnet", "ropsten", "polygon_testnet"].includes(networkName)
    ? exports.getDefenderSigner(speed)
    : (await ethers.getSigners())[0];
exports.getSigner = getSigner;
//# sourceMappingURL=defender-utils.js.map