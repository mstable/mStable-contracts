import { impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import { PFRAX, PmUSD } from "tasks/utils"
import { Account } from "types"
import { ERC20, ERC20__factory, FeederPool, FeederPool__factory, IERC20, IERC20__factory } from "types/generated"

const accountAddress = "0xdccb7a6567603af223c090be4b9c83eced210f18"

context("FRAX Feeder Pool on Polygon", () => {
    let account: Account
    let frax: ERC20
    let fraxFp: FeederPool
    let musd: IERC20

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16440763,
                    },
                },
            ],
        })
        account = await impersonateAccount(accountAddress)

        frax = ERC20__factory.connect(PFRAX.address, account.signer)
        fraxFp = FeederPool__factory.connect(PFRAX.feederPool, account.signer)
        musd = await IERC20__factory.connect(PmUSD.address, account.signer)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await account.signer.getBalance()
        console.log(`Deployer ${account} has ${startEther} Ether`)
    })
    it("Approve spend of FRAX", async () => {
        expect(await frax.allowance(account.address, PFRAX.feederPool), "Allowance before").to.eq(0)
        const approveAmount = simpleToExactAmount(20)
        await frax.approve(PFRAX.feederPool, approveAmount)
        expect(await frax.allowance(account.address, PFRAX.feederPool), "Allowance after").to.eq(approveAmount)
    })
    it("Approve spend of mUSD", async () => {
        expect(await musd.allowance(account.address, PFRAX.feederPool), "Allowance before").to.eq(0)
        const approveAmount = simpleToExactAmount(21)
        await musd.approve(PFRAX.feederPool, approveAmount)
        expect(await musd.allowance(account.address, PFRAX.feederPool), "Allowance after").to.eq(approveAmount)
    })
    it("Mint fraxFp", async () => {
        const bAssetAmount = simpleToExactAmount(10)
        const minAmount = simpleToExactAmount(9)
        expect(await frax.balanceOf(account.address), "FRAX balance before").to.gt(bAssetAmount)
        expect(await musd.balanceOf(account.address), "mUSD balance before").to.gt(bAssetAmount)
        expect(await fraxFp.balanceOf(account.address), "fraxFp balance before").to.eq(0)
        expect(await fraxFp.totalSupply(), "totalSupply before").to.eq(0)

        await fraxFp.mintMulti([PFRAX.address, PmUSD.address], [bAssetAmount, bAssetAmount], minAmount, account.address)

        expect(await fraxFp.balanceOf(account.address), "fraxFp balance after").to.gt(minAmount)
        expect(await fraxFp.totalSupply(), "totalSupply after").to.gt(minAmount)
    })
})
