import axios from "axios"
import { subtask, task, types } from "hardhat/config"
import { IEjector__factory, IncentivisedVotingLockup__factory } from "types/generated"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"

task("eject-stakers", "Ejects expired stakers from Meta staking contract (vMTA)")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const ejectorAddress = getChainAddress("Ejector", chain)
        console.log(`Ejector address ${ejectorAddress}`)
        const ejector = IEjector__factory.connect(ejectorAddress, signer)
        // TODO check the last time the eject was run
        // Check it's been more than 7 days since the last eject has been run

        // get stakers from API
        const response = await axios.get("https://api-dot-mstable.appspot.com/stakers")
        const stakers = response.data.ejected

        if (stakers.length === 0) {
            console.error(`No stakers to eject`)
            process.exit(0)
        }
        console.log(`${stakers.length} stakers to be ejected: ${stakers}`)
        const tx = await ejector.ejectMany(stakers)
        await logTxDetails(tx, "ejectMany")
    })

subtask("vmta-expire", "Expire old staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const vmtaAddress = resolveAddress("vMTA", chain)
        const vmta = IncentivisedVotingLockup__factory.connect(vmtaAddress, signer)
        const tx = await vmta.expireContract()
        await logTxDetails(tx, "Expire old V1 MTA staking contract")
    })
task("vmta-expire").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vmta-withdraw", "Withdraw MTA from old Staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const vmtaAddress = resolveAddress("vMTA", chain)
        const vmta = IncentivisedVotingLockup__factory.connect(vmtaAddress, signer)
        const tx = await vmta.withdraw()
        await logTxDetails(tx, "Withdraw MTA from Staking V1 contract")
    })
task("vmta-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vmta-claim", "Claim MTA from old Staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const vmtaAddress = resolveAddress("vMTA", chain)
        const vmta = IncentivisedVotingLockup__factory.connect(vmtaAddress, signer)
        const tx = await vmta.claimReward()
        await logTxDetails(tx, "Claim MTA from old Staking V2 contract")
    })
task("vmta-claim").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vmta-exit", "Withdraw and claim MTA from old Staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const vmtaAddress = resolveAddress("vMTA", chain)
        const vmta = IncentivisedVotingLockup__factory.connect(vmtaAddress, signer)
        const tx = await vmta.exit()
        await logTxDetails(tx, "Withdraw and claim MTA from old Staking V2 contract")
    })
task("vmta-exit").setAction(async (_, __, runSuper) => {
    await runSuper()
})
