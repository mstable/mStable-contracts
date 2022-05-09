import { impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers, network } from "hardhat"
import { PFRAX, PmUSD } from "tasks/utils"
import { Account } from "types"
import { ERC20, ERC20__factory, RebasedFeederPool, RebasedFeederPool__factory, IERC20, IERC20__factory } from "types/generated"

const accountAddress = "0xdccb7a6567603af223c090be4b9c83eced210f18"

// set the correct hardhat configuration file at "test:file:fork": "yarn hardhat --config hardhat-fork.config.ts test",
// set env variable NODE_URL pointing to the correct node,
// yarn test:file:fork   TEST_FILE.spec.ts

// Integration tests with day to day actions for example :
// Deployment of the fPool with close to real data.
//  Alice deposits some tokens, bob  deposits some tokens, alice withdraw after some days and bob withdraw after some days.
//  Alice mints some tokens, bob  redeems some tokens
//  Permutations of multiple mints and redeems
//  Stress the behavior of _getMemBassetData()#bAssetData[F_INDEX].vaultBalance is it prone to price manipulation ? For example, flash loan attacks
//  Stress the behavior of _updateBassetData()#data.bAssetData[F_INDEX].vaultBalance is it prone to price manipulation ?
//  Are those  2 scenarios cover by contracts/feeders/FeederLogic.sol#computeMint? require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
// The price of the fpToken can be manipulated by sending fasset token directly to the pool, 
// await fAsset.connect(sa.default.signer).approve(details.pool.address, simpleToExactAmount(XXXXX, 6))
// await fAsset.connect(sa.default.signer).transfer(details.pool.address, simpleToExactAmount(XXXXX, 6)) // this will increase the price 
// TWAP
context.skip("Overnight Feeder Pool on Polygon", () => {
    let account: Account

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

        musd = await IERC20__factory.connect(PmUSD.address, account.signer)
    })
    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
        const startEther = await account.signer.getBalance()
        console.log(`Deployer ${account} has ${startEther} Ether`)
    })
    it("Approve spend of usd+", async () => {
        // TODO
    })
    it("Approve spend of mUSD", async () => {
        // TODO
    })
    it("Mint usdFp", async () => {
        // TODO
    })
    it("vaultBalance behavior when a whale deposits or flashloan attack, how does it behave?", async () => {
        // function _getMemBassetData() internal view returns (BassetData[] memory bAssetData) {
        //     bAssetData = new BassetData[](NUM_ASSETS);
        //     bAssetData[M_INDEX] = data.bAssetData[M_INDEX];
        //     bAssetData[F_INDEX].vaultBalance = uint128(IERC20(data.bAssetPersonal[F_INDEX].addr).balanceOf(address(this)));
        //     bAssetData[F_INDEX].ratio = data.bAssetData[F_INDEX].ratio;
        // }
        // function _updateBassetData() internal {
        //     data.bAssetData[F_INDEX].vaultBalance = uint128(IERC20(data.bAssetPersonal[F_INDEX].addr).balanceOf(address(this)));
        // }
    })
})
