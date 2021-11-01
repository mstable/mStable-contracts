import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import { IERC20, IERC20__factory, Unwrapper, Unwrapper__factory } from "types/generated"
import { simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"

const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
const musdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5"
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f"
const alusdFeederPool = "0x4eaa01974B6594C0Ee62fFd7FEE56CF11E6af936"
const alusdAddress = "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9"

enum Route {
    Masset,
    Feeder,
}

context("Unwrapper", () => {
    let deployer: Signer
    let unwrapper: Unwrapper
    let musd: IERC20

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13529662,
                    },
                },
            ],
        })
        deployer = await impersonate(musdHolderAddress)
        musd = IERC20__factory.connect(musdAddress, deployer)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await deployer.getBalance()
        const address = await deployer.getTransactionCount()
        console.log(`Deployer ${address} has ${startEther} Ether`)
    })

    it("Deploys the unwrapper contract ", async () => {
        unwrapper = await deployContract<Unwrapper>(new Unwrapper__factory(deployer), "Unwrapper")
        expect(unwrapper.address).to.length(42)
        console.log(`Unwrapper deployed at ${unwrapper.address}`)
    })

    it("Receives the correct output from getUnwrapOutput", async () => {
        const config = {
            routeIndex: Route.Masset,
            router: musdAddress,
            input: musdAddress,
            output: "0x6b175474e89094c44da98b954eedeac495271d0f",
            amount: simpleToExactAmount(1, 18),
        }
        const output = await unwrapper.getUnwrapOutput(config.routeIndex, config.router, config.input, config.output, config.amount)
        expect(output.toString()).to.be.length(19)
        console.log(`Unwrap output: ${output}`)
    })

    const validateAssetRedemption = async (config: {
        routeIndex: number
        router: string
        input: string
        output: string
        amount: BigNumber
    }) => {
        // Get estimated output via getUnwrapOutput
        const amountOut = await unwrapper.getUnwrapOutput(config.routeIndex, config.router, config.input, config.output, config.amount)
        expect(amountOut.toString().length).to.be.gte(18)
        const minAmountOut = amountOut.mul(98).div(1e2)

        const newConfig = {
            ...config,
            minAmountOut,
            beneficiary: deployerAddress,
        }

        // check balance before
        const tokenOut = IERC20__factory.connect(config.output, deployer)
        const tokenBalanceBefore = await tokenOut.balanceOf(deployerAddress)

        // approve musd for unwrapping
        await musd.approve(unwrapper.address, config.amount)

        // redeem to basset via unwrapAndSend
        await unwrapper.unwrapAndSend(
            newConfig.routeIndex,
            newConfig.router,
            newConfig.input,
            newConfig.output,
            newConfig.amount,
            newConfig.minAmountOut,
            newConfig.beneficiary,
        )

        // check balance after
        const tokenBalanceAfter = await tokenOut.balanceOf(deployerAddress)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore.add(minAmountOut))
    }

    it("Unwraps to bAsset and sends to beneficiary via unwrapAndSend", async () => {
        const config = {
            routeIndex: Route.Masset,
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
        }
        validateAssetRedemption(config)
    })

    it("Unwraps to fAsset and sends to beneficiary via unwrapAndSend", async () => {
        const config = {
            routeIndex: Route.Feeder,
            router: alusdFeederPool,
            input: musdAddress,
            output: alusdAddress,
            amount: simpleToExactAmount(1, 18),
        }
        validateAssetRedemption(config)
    })
})
