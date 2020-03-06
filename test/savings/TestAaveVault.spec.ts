
import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ForceSendInstance, ERC20MockInstance } from "types/generated";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine } from "@utils/machines";

const { expect, assert } = envSetup.configure();

const ForceSend = artifacts.require("ForceSend");
const ERC20Mock = artifacts.require("ERC20Mock");

// const Web3 = require("web3");

// const web3 = new Web3(new Web3.providers.HttpProvider("localhost:7545"))
const fs = require("fs");

contract("AaveVault", async (accounts) => {

    const DAIAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    
    let systemMachine: SystemMachine;

    beforeEach("before Each", async () => {
        
        // COMMAND FOR GANACHE FORK
        // ========================
        // ganache-cli -f https://mainnet.infura.io/v3/810573cebf304c4f867483502c8b7b93@9618357 -p 7545 -l 100000000 --allowUnlimitedContractSize --unlock "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b"
        // ========================

        // 1. send ETH to DAI contract
        // deploy SelfDestruct Contract
        // forceSendContract = await ForceSend.new();       
        // await forceSendContract.go(DAIAddress, {value: new BN(10000)});
        // console.log((await web3.eth.getBalance(DAIAddress)));

        // 2. connect to DAI contract
        // check balances of any existing DAI holder
        // const DAI = new web3.eth.Contract(obj.abi);
        // const instance = await ERC20Mock.at(DAIAddress);


        // const okExAddress = "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b";
        // const bal: BN = await instance.balanceOf(okExAddress);
        // console.log(bal);
        // console.log(bal.toString(10));


        // await instance.transfer(accounts[0], new BN(1000), {from: okExAddress});
        // const balance = await instance.balanceOf(accounts[0]);
        // console.log(balance);

        const sa = new StandardAccounts(accounts);
        systemMachine = new SystemMachine(sa.all, sa.other);
        await systemMachine.initialiseMocks();

    } );

    describe("DAI test", async () => {
        it("DAI", async () => {
            // test
        });
    });
});