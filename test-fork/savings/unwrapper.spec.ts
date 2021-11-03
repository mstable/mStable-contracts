import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { expect } from "chai"
import { network } from "hardhat"
import { deployContract } from "tasks/utils/deploy-utils"
import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    IERC20__factory,
    Nexus__factory,
    SavingsContract,
    SavingsContract__factory,
    Unwrapper,
    UnwrapperProxy__factory,
    Unwrapper__factory,
} from "types/generated"
import { Chain, increaseTime, ONE_WEEK, simpleToExactAmount } from "index"
import { BigNumber } from "@ethersproject/bignumber"
import { getChainAddress } from "tasks/utils/networkAddressFactory"

const chain = Chain.mainnet
const delayedProxyAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
const governorAddress = getChainAddress("Governor", chain)
const nexusAddress = getChainAddress("Nexus", chain)

const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const musdHolderAddress = "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"
const imusdAddress = "0x30647a72Dc82d7Fbb1123EA74716aB8A317Eac19"
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
    let musdHolder: Signer
    let unwrapper: Unwrapper
    let governor: Signer
    let delayedProxyAdmin: DelayedProxyAdmin

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
        governor = await impersonate(governorAddress)
        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
    })
    it("Test connectivity", async () => {
        const startEther = await deployer.getBalance()
        const address = await deployer.getTransactionCount()
        console.log(`Deployer ${address} has ${startEther} Ether`)
    })

    it("Deploys the unwrapper proxy contract ", async () => {
        const unwrapperImpl = await deployContract<Unwrapper>(new Unwrapper__factory(deployer), "Unwrapper")
        expect(unwrapperImpl.address).to.length(42)

        const data = unwrapperImpl.interface.encodeFunctionData("initialize")
        const proxy = await new UnwrapperProxy__factory(deployer).deploy(unwrapperImpl.address, delayedProxyAdminAddress, data)

        unwrapper = Unwrapper__factory.connect(proxy.address, musdHolder)
        await expect(unwrapper.initialize()).to.reverted

        // verify owner of unwrapper contract set as deployer
        expect(await Unwrapper__factory.connect(proxy.address, deployer).callStatic.owner()).to.eq(deployerAddress)

        // approve tokens for router
        const routers = [alusdFeederPool]
        const tokens = [musdAddress]
        await Unwrapper__factory.connect(proxy.address, deployer).approve(routers, tokens)
    })

    it("Upgrade the unwrapper contract", async () => {
        const admin = await impersonate(delayedProxyAdminAddress)

        const unwrapperImpl = await deployContract<Unwrapper>(new Unwrapper__factory(deployer), "Unwrapper")
        expect(unwrapperImpl.address).to.length(42)

        const unwrapperProxy = UnwrapperProxy__factory.connect(unwrapper.address, admin)
        expect(await unwrapperProxy.callStatic.admin(), "proxy admin before").to.eq(delayedProxyAdminAddress)
        expect(await unwrapperProxy.callStatic.implementation(), "unwrapper impl address before").to.not.eq(unwrapperImpl.address)

        // Update the Unwrapper proxy to point to the new implementation using the delayed proxy admin
        await delayedProxyAdmin.proposeUpgrade(unwrapper.address, unwrapperImpl.address, [])
        await increaseTime(ONE_WEEK.add(60))
        await delayedProxyAdmin.acceptUpgradeRequest(unwrapper.address)

        expect(await unwrapperProxy.callStatic.implementation(), "unwrapper impl address after").to.eq(unwrapperImpl.address)
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
        const signerAddress = await signer.getAddress()

        const amountOut = await unwrapper.getUnwrapOutput(config.routeIndex, config.router, config.input, config.output, config.amount)
        expect(amountOut.toString().length).to.be.gte(18)
        const minAmountOut = amountOut.mul(98).div(1e2)

        const newConfig = {
            ...config,
            minAmountOut,
            beneficiary: signerAddress,
        }

        // check balance before
        const tokenOut = IERC20__factory.connect(config.output, signer)
        const tokenBalanceBefore = await tokenOut.balanceOf(signerAddress)

        // approve musd for unwrapping
        const musd = IERC20__factory.connect(musdAddress, signer)
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
        const tokenBalanceAfter = await tokenOut.balanceOf(signerAddress)
        expect(tokenBalanceAfter, "Token balance has increased").to.be.gt(tokenBalanceBefore)
    }

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

    it("Unwraps to bAsset and sends to beneficiary via unwrapAndSend", async () => {
        const config = {
            routeIndex: Route.Masset,
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
        }
        await validateAssetRedemption(config, musdHolder)
    })

    it("Unwraps to fAsset and sends to beneficiary via unwrapAndSend", async () => {
        const config = {
            routeIndex: Route.Feeder,
            router: alusdFeederPool,
            input: musdAddress,
            output: alusdAddress,
            amount: simpleToExactAmount(1, 18),
        }
        await validateAssetRedemption(config, musdHolder)
    })

    it("Upgrades the save contract", async () => {
        const musdSaveImpl = await deployContract<SavingsContract>(
            new SavingsContract__factory(deployer),
            "mStable: mUSD Savings Contract",
            [nexusAddress, musdAddress],
        )

        const data = musdSaveImpl.interface.encodeFunctionData("upgrade", [unwrapper.address])
        expect(await delayedProxyAdmin.callStatic.nexus(), "nexus not match").to.eq(nexusAddress)
        expect(await Nexus__factory.connect(nexusAddress, governor).callStatic.governor(), "governor not match").to.eq(governorAddress)

        await delayedProxyAdmin.proposeUpgrade(imusdAddress, musdSaveImpl.address, data)
        await increaseTime(ONE_WEEK.add(60))

        // check request is correct
        const request = await delayedProxyAdmin.requests(imusdAddress)
        expect(request.data).eq(data)
        expect(request.implementation).eq(musdSaveImpl.address)

        // accept upgrade
        await delayedProxyAdmin.acceptUpgradeRequest(imusdAddress)

        // verify unwrapper address set
        const saveContractProxy = SavingsContract__factory.connect(imusdAddress, governor)
        const unwrapperAddress = await saveContractProxy.unwrapper()
        expect(unwrapperAddress).to.eq(unwrapper.address)

        // verify can't call upgrade again
        await expect(saveContractProxy.upgrade(unwrapper.address)).to.revertedWith("Unwrapper address is not zero")
    })

    it("Save contract works after upgraded", async () => {
        const imusdHolderAddress = "0xdA1fD36cfC50ED03ca4dd388858A78C904379fb3"
        const imusdHolder = await impersonate(imusdHolderAddress)

        const config = {
            routeIndex: Route.Masset,
            router: musdAddress,
            input: musdAddress,
            output: daiAddress,
            amount: simpleToExactAmount(1, 18),
        }

        // Get estimated output via getUnwrapOutput
        const amountOut = await unwrapper.getUnwrapOutput(config.routeIndex, config.router, config.input, config.output, config.amount)
        expect(amountOut.toString().length).to.be.gte(18)
        const minAmountOut = amountOut.mul(98).div(1e2)

        // dai balance before
        const daiBalanceBefore = await IERC20__factory.connect(daiAddress, imusdHolder).balanceOf(imusdHolderAddress)

        const saveContractProxy = SavingsContract__factory.connect(imusdAddress, imusdHolder)
        await saveContractProxy.redeemAndUnwrap(
            config.amount,
            minAmountOut,
            config.output,
            imusdHolderAddress,
            config.router,
            config.routeIndex,
        )

        const daiBalanceAfter = await IERC20__factory.connect(daiAddress, imusdHolder).balanceOf(imusdHolderAddress)
        expect(daiBalanceAfter, "Token balance has increased").to.be.gt(daiBalanceBefore.add(minAmountOut))
    })
})
