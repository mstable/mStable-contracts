import fullIntegrationData from "./full/fPoolIntegrationData.json"
import fullMintData from "./full/fPoolMintData.json"
import fullMintMultiData from "./full/fPoolMintMultiData.json"
import fullSwapData from "./full/fPoolSwapData.json"
import fullRedeemData from "./full/fPoolRedeemData.json"
import fullRedeemPropData from "./full/fPoolRedeemProportionalData.json"
import fullRedeemExactData from "./full/fPoolRedeemMultiData.json"

import sampleIntegrationData from "./sample/fPoolIntegrationData.json"
import sampleMintData from "./sample/fPoolMintData.json"
import sampleMintMultiData from "./sample/fPoolMintMultiData.json"
import sampleSwapData from "./sample/fPoolSwapData.json"
import sampleRedeemData from "./sample/fPoolRedeemData.json"
import sampleRedeemPropData from "./sample/fPoolRedeemProportionalData.json"
import sampleRedeemExactData from "./sample/fPoolRedeemMultiData.json"

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

const redeemProportionalData: Data = {
    full: fullRedeemPropData,
    sample: sampleRedeemPropData,
}

const redeemExactData: Data = {
    full: fullRedeemExactData,
    sample: sampleRedeemExactData,
}

export default { integrationData, mintData, mintMultiData, swapData, redeemData, redeemProportionalData, redeemExactData }
