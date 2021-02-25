import fullIntegrationData from "./full/integrationData.json"
import fullMintData from "./full/mintTestData.json"
import fullMintMultiData from "./full/mintMultiTestData.json"
import fullSwapData from "./full/swapTestData.json"
import fullRedeemData from "./full/redeemTestData.json"
import fullRedeemMassetData from "./full/redeemMassetTestData.json"
import fullRedeemExactData from "./full/redeemExactTestData.json"

import sampleIntegrationData from "./sample/integrationData.json"
import sampleMintData from "./sample/mintTestData.json"
import sampleMintMultiData from "./sample/mintMultiTestData.json"
import sampleSwapData from "./sample/swapTestData.json"
import sampleRedeemData from "./sample/redeemTestData.json"
import sampleRedeemMassetData from "./sample/redeemMassetTestData.json"
import sampleRedeemExactData from "./sample/redeemExactTestData.json"

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

const mintMultiData: Data = {
    full: fullMintMultiData,
    sample: sampleMintMultiData,
}

const swapData: Data = {
    full: fullSwapData,
    sample: sampleSwapData,
}

const redeemData: Data = {
    full: fullRedeemData,
    sample: sampleRedeemData,
}

const redeemMassetData: Data = {
    full: fullRedeemMassetData,
    sample: sampleRedeemMassetData,
}

const redeemExactData: Data = {
    full: fullRedeemExactData,
    sample: sampleRedeemExactData,
}

export default { integrationData, mintData, mintMultiData, swapData, redeemData, redeemMassetData, redeemExactData }
