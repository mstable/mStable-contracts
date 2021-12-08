/* eslint-disable no-restricted-syntax */
import { subtask, task, types } from "hardhat/config"
import { DisperseForwarder__factory, EmissionsController__factory, IERC20__factory } from "types/generated"
import { logTxDetails } from "./utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

subtask("emission-calc", "Calculate the weekly emissions")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        // Resolve the vault addresses from the asset symbols
        const emissionsControllerAddress = resolveAddress("EmissionsController", chain)
        const emissionsController = EmissionsController__factory.connect(emissionsControllerAddress, signer)

        const tx = await emissionsController.calculateRewards()
        await logTxDetails(tx, "Calculate Rewards")
    })
task("emission-calc").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("emission-dist", "Distribute the weekly emissions")
    .addOptionalParam("dials", "The number of dials starting at 0", 15, types.int)
    .addOptionalParam("dialIds", "A comma separated list of dial ids", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const emissionsControllerAddress = resolveAddress("EmissionsController", chain)
        const emissionsController = EmissionsController__factory.connect(emissionsControllerAddress, signer)

        const dialIds = taskArgs.dialIds ? taskArgs.dialIds.split(",").map(Number) : [...Array(taskArgs.dials).keys()]

        const tx = await emissionsController.distributeRewards(dialIds)
        await logTxDetails(tx, "Distribute Rewards")
    })
task("emission-dist").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("emission-disperse-bal", "Disperse Polygon Balancer Pool MTA rewards in a DisperseForwarder contract")
    .addParam("report", "Report number from the bal-mining-script repo. eg 79", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const disperseForwarderAddress = resolveAddress("DisperseForwarder", chain)
        const disperseForwarder = DisperseForwarder__factory.connect(disperseForwarderAddress, signer)

        const mtaAddress = resolveAddress("MTA", chain)
        const mtaToken = IERC20__factory.connect(mtaAddress, signer)

        // Get the amount of MTA in the DisperseForwarder contract
        const mtaBalance = await mtaToken.balanceOf(disperseForwarderAddress)

        // TODO need get the MTA report from the bal-mining-script repo under the reports folder.
        // The Polygon MTA rewards for  will be in the __polygon_0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0.json file under the report folder with a week number.
        // eg https://github.com/balancer-labs/bal-mining-scripts/blob/master/reports/79/__polygon_0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0.json
        // The amounts in this file assumes 15k MTA is being distributed but this will not be the case with the emissions controller.
        // Need to proportion the MTA balance in the DisperseForwarder contract to the recipients based off the bal-mining-script report.

        const recipients = []
        const values = []
        const tx = await disperseForwarder.disperseToken(recipients, values)
        await logTxDetails(tx, `Disperse Balancer Pool MTA rewards to ${recipients.length} recipients`)
    })
task("emission-disperse-bal").setAction(async (_, __, runSuper) => {
    await runSuper()
})
