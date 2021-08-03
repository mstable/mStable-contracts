/* eslint-disable no-restricted-syntax */
import { BN, simpleToExactAmount } from "@utils/math"
import { task, types } from "hardhat/config"
import rewardsFiles from "./balancer-mta-rewards/20210803.json"
import { usdFormatter } from "./utils"

task("sum-rewards", "Totals the rewards in a disperse json file")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async () => {
        let total = BN.from(0)
        let count = 0
        const rewardsSorted = Object.fromEntries(Object.entries(rewardsFiles).sort(([, a], [, b]) => parseFloat(a) - parseFloat(b)))

        for (const [address, amount] of Object.entries(rewardsSorted)) {
            total = total.add(simpleToExactAmount(amount))
            count += 1
            console.log(`address ${address} ${amount}`)
        }
        console.log(`Total ${usdFormatter(total)}`)
        console.log(`Count ${count}`)
    })
