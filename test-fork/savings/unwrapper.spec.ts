import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import {
    DelayedProxyAdmin__factory,
    IERC20,
    IERC20__factory,
    Nexus__factory,
    SavingsContract,
    SavingsContract__factory,
    Unwrapper,
    Unwrapper__factory,
} from "types/generated"
import { increaseTime, ONE_WEEK, simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"

const deployerAddress = "0x19f12c947d25ff8a3b748829d8001ca09a28d46d"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
const musdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5"
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f"
const alusdFeederPool = "0x4eaa01974B6594C0Ee62fFd7FEE56CF11E6af936"
const alusdAddress = "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9"
const beneficiary = "0x594FEB6Ee83AdDAEfc8ae8E8450cB9e3f803Dfb6" // rando

enum Route {
    Masset,
    Feeder,
}

context("Unwrapper", () => {
    let deployer: Signer
    let musdHolder: Signer
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
        musdHolder = await impersonate(musdHolderAddress)
        deployer = await impersonate(deployerAddress)
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
    })

    const validateAssetRedemption = async (
        config: {
            routeIndex: number
            router: string
            input: string
            output: string
            amount: BigNumber
        },
        signer: Signer,
    ) => {
        // Get estimated output via getUnwrapOutput
        const amountOut = await unwrapper.getUnwrapOutput(config.routeIndex, config.router, config.input, config.output, config.amount)
        expect(amountOut.toString().length).to.be.gte(18)
        const minAmountOut = amountOut.mul(98).div(1e2)

        const newConfig = {
            ...config,
            minAmountOut,
            beneficiary,
        }

        // check balance before
        const tokenOut = IERC20__factory.connect(config.output, signer)
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

    xit("Unwraps to bAsset and sends to beneficiary via unwrapAndSend", async () => {
        const config = {
            routeIndex: Route.Masset,
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
        }
        validateAssetRedemption(config, musdHolder)
    })

    xit("Unwraps to fAsset and sends to beneficiary via unwrapAndSend", async () => {
        const config = {
            routeIndex: Route.Feeder,
            router: alusdFeederPool,
            input: musdAddress,
            output: alusdAddress,
            amount: simpleToExactAmount(1, 18),
        }
        validateAssetRedemption(config, musdHolder)
    })

    it("upgrades the save contract", async () => {
        const imusdAddress = "0x30647a72Dc82d7Fbb1123EA74716aB8A317Eac19"
        const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
        const delayedProxyAdminAddress = "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
        const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
        const poker = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"
        const governor = await impersonate(governorAddress)

        const musdSaveImpl = await deployContract<SavingsContract>(
            new SavingsContract__factory(deployer),
            "mStable: mUSD Savings Contract",
            [nexusAddress, musdAddress, unwrapper.address],
        )
        const initializeData = musdSaveImpl.interface.encodeFunctionData("initialize", [poker, "xxx", "xxx"])

        const delayedProxy = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
        expect(await delayedProxy.callStatic.nexus(), "nexus not match").to.eq(nexusAddress)
        expect(await Nexus__factory.connect(nexusAddress, governor).callStatic.governor(), "governor not match").to.eq(governorAddress)
        // FIXME: - works if initializeData = []; triggers upgradeTo() rather than upgradeToAndCall()
        await delayedProxy.proposeUpgrade(imusdAddress, musdSaveImpl.address, initializeData)
        await increaseTime(ONE_WEEK.add(60))

        // check request is correct
        const request = await delayedProxy.requests(imusdAddress)
        expect(request.data).eq(initializeData)
        expect(request.implementation).eq(musdSaveImpl.address)

        // accept upgrade
        await delayedProxy.acceptUpgradeRequest(imusdAddress)
    })
})
