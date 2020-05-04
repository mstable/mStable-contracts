// eslint-disable-next-line import/no-extraneous-dependencies
import * as Web3 from "web3";

import { Address } from "./common";

declare type ContractTest = (accounts: Address[]) => void;
declare type ExecutionBlock = () => void;
declare type AsyncExecutionBlock = (done: () => void) => void;

declare global {
    const web3: Web3;

    function contract(name: string, test: ContractTest): void;
}
