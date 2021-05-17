import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { ethers, network } from "hardhat"
import { deployContract, logTxDetails } from "tasks/utils/deploy-utils"
import { Poker, Poker__factory } from "types/generated"

const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"

context("Boosted vault poker", () => {
    let deployer: Signer
    let poker: Poker

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12450000,
                    },
                },
            ],
        })
        deployer = await impersonate(deployerAddress)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await deployer.getBalance()
        console.log(`Deployer ${deployerAddress} has ${startEther} Ether`)
    })
    it("Deploy Poker", async () => {
        poker = await deployContract<Poker>(new Poker__factory(deployer), "Poker")
    })
    it("Poke single vault", async () => {
        const tx = await poker.poke([
            {
                boostVault: "0x760ea8cfdcc4e78d8b9ca3088ecd460246dc0731",
                accounts: ["0x69e0e2b3d523d3b247d798a49c3fa022a46dd6bd", "0x7e849911b62b91eb3623811a42b9820a4a78755b"],
            },
        ])
        await logTxDetails(tx, "poke")
    })
    it("Poke all vaults", async () => {
        const tx = await poker.poke([
            {
                boostVault: "0x760ea8cfdcc4e78d8b9ca3088ecd460246dc0731",
                accounts: [
                    "0x69e0e2b3d523d3b247d798a49c3fa022a46dd6bd",
                    "0x7e849911b62b91eb3623811a42b9820a4a78755b",
                    "0x8d0f5678557192e23d1da1c689e40f25c063eaa5",
                    "0xb83035f4415233e8765d8a1870852a01dae783f3",
                    "0xd6293058080c5f03c5c8b954ea87a5cf2d57d74c",
                ],
            },
            {
                boostVault: "0xadeedd3e5768f7882572ad91065f93ba88343c99",
                accounts: [
                    "0x25953c127efd1e15f4d2be82b753d49b12d626d7",
                    "0x3841ef91d7e7af21cd2b6017a43f906a99b52bde",
                    "0x4630914247bfabf1159cfeae827c9597743661bd",
                    "0x8d0f5678557192e23d1da1c689e40f25c063eaa5",
                    "0xaa6ad7089a5ce90b36bd2a839acdca240f3e51c8",
                    "0xf794cf2d946bc6ee6ed905f47db211ebd451aa5f",
                    "0xf7f502609de883a240536832e7917db9ee802990",
                ],
            },
            {
                boostVault: "0xd124b55f70d374f58455c8aedf308e52cf2a6207",
                accounts: [
                    "0x4630914247bfabf1159cfeae827c9597743661bd",
                    "0x7e849911b62b91eb3623811a42b9820a4a78755b",
                    "0x8d0f5678557192e23d1da1c689e40f25c063eaa5",
                    "0x9b3f49a186670194f625199b822fcbdfd3feacf7",
                    "0xaa6ad7089a5ce90b36bd2a839acdca240f3e51c8",
                    "0xaf7855c1019c6c3d8a4baf8585a496cdafece395",
                    "0xb83035f4415233e8765d8a1870852a01dae783f3",
                    "0xdc1f6fd4e237d86d30ae62ef0fbf6412eb07ec36",
                    "0xe7a8ea7dfa061c0ac7ade4134e597d073600ce53",
                    "0xf695289caf65ff991ace9957873d2913bcfb321d",
                    "0xf7f502609de883a240536832e7917db9ee802990",
                ],
            },
            {
                boostVault: "0xf38522f63f40f9dd81abafd2b8efc2ec958a3016",
                accounts: ["0xdcd4a180cb5bca150b6b9b2f48a043b3640ed6ed", "0xf6853c77a2452576eae5af424975a101ffc47308"],
            },
            {
                boostVault: "0xf65d53aa6e2e4a5f4f026e73cb3e22c22d75e35c",
                accounts: ["0x25953c127efd1e15f4d2be82b753d49b12d626d7", "0x7e849911b62b91eb3623811a42b9820a4a78755b"],
            },
        ])
        await logTxDetails(tx, "poke")
    })
})
