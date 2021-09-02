import { HardhatRuntimeEnvironment } from "hardhat/types"

interface VerifyEtherscan {
    address: string
    contract?: string
    constructorArguments?: any[]
    libraries?: {
        [libraryName: string]: string
    }
}

export const verifyEtherscan = async (hre: HardhatRuntimeEnvironment, contract: VerifyEtherscan): Promise<void> => {
    if (hre.network.name !== "hardhat") {
        await hre.run("verify:verify", contract)
    }
}
