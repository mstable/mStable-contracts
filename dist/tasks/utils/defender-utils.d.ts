import { Speed } from "defender-relay-client";
import { Signer } from "ethers";
export declare const getDefenderSigner: (speed?: Speed) => Promise<Signer>;
export declare const getSigner: (networkName: string, ethers: any, speed?: Speed) => Promise<Signer>;
