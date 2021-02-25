import fullIntegrationData from "./full/crossIntegrationData.json"
import fullMintData from "./full/crossMintData.json"
import fullSwapToFassetData from "./full/swapToFassetData.json"
import fullSwapToMPassetData from "./full/swapToMPassetData.json"
import fullRedeemData from "./full/crossRedeemData.json"

import sampleIntegrationData from "./sample/crossIntegrationData.json"
import sampleMintData from "./sample/crossMintData.json"
import sampleSwapToFassetData from "./sample/swapToFassetData.json"
import sampleSwapToMPassetData from "./sample/swapToMPassetData.json"
import sampleRedeemData from "./sample/crossRedeemData.json"

interface Data {
    full
    sample
}

const integrationData: Data = {
    full: fullIntegrationData,
    sample: sampleIntegrationData,
}

const mintData: Data = {
    full: fullMintData,
    sample: sampleMintData,
}

const swapToFassetData: Data = {
    full: fullSwapToFassetData,
    sample: sampleSwapToFassetData,
}

const swapToMPassetData: Data = {
    full: fullSwapToMPassetData,
    sample: sampleSwapToMPassetData,
}

const redeemData: Data = {
    full: fullRedeemData,
    sample: sampleRedeemData,
}

export default { integrationData, mintData, swapToFassetData, swapToMPassetData, redeemData }
