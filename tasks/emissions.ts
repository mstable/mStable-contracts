/* eslint-disable no-restricted-syntax */
import { subtask, task, types } from "hardhat/config"
import { DisperseForwarder__factory, EmissionsController__factory, IERC20__factory } from "types/generated"
import { logTxDetails } from "./utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { getBalancerPolygonReport } from "./utils/emission-disperse-bal"

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

        // Get the proportion the MTA balance in the DisperseForwarder contract to the recipients based off the bal-mining-script report.
        const { disperser } = await getBalancerPolygonReport(taskArgs.report, mtaBalance)

        const tx = await disperseForwarder.disperseToken(disperser.recipients, disperser.values)
        await logTxDetails(tx, `Disperse Balancer Pool MTA rewards ${disperser.total}  to ${disperser.recipients} recipients`)
    })
task("emission-disperse-bal").setAction(async (_, __, runSuper) => {
    await runSuper()
})
