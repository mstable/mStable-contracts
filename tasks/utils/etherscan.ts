import { HardhatRuntimeEnvironment } from "hardhat/types"

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface VerifyEtherscan {
    address: string
    contract?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
    constructorArguments?: any[]
    libraries?: {
        [libraryName: string]: string
    }
}

export const verifyEtherscan = async (hre: HardhatRuntimeEnvironment, contract: VerifyEtherscan): Promise<void> => {
    if (hre.network.name !== "hardhat" && hre.network.name !== "local") {
        // wait for the Etherscan backend to pick up the deployed contract
        await sleep(10000)

        console.log(`About to verify ${contract.address} on Etherscan`)
        await hre.run("verify:verify", contract)
    }
}
