// import fullIntegrationData from "./full/crossIntegrationData.json"

import sampleIntegrationData from "./sample/crossIntegrationData.json"

interface Data {
    full
    sample
}

const integrationData: Data = {
    full: null,
    sample: sampleIntegrationData,
}

export default { integrationData }
