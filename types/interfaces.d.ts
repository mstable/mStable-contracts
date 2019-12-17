import * as Web3 from "web3";
import { Address, UInt } from "./common";

declare type ContractTest = (accounts: Address[]) => void;
declare type ExecutionBlock = () => void;
declare type AsyncExecutionBlock = (done: () => void) => void;

interface Artifacts {
    require(name: string): Web3.ContractInstance;
}

declare global {
    function contract(name: string, test: ContractTest): void;

    var artifacts: Artifacts;
    var web3: Web3;
}
