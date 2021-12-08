import https from "https"
import { BN, simpleToExactAmount } from "@utils/math"

const MTA_ADDRESS = "0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0"
const REPORT_URL = "https://raw.githubusercontent.com/balancer-labs/bal-mining-scripts/master/reports"

interface DisperseDetails {
    total: BN
    recipients: Array<string>
    values: Array<BN>
}
interface BalancerReward {
    address: string
    amount: string
}
interface BalancerDetails {
    total: BN
    rewards: Array<BalancerReward>
}

interface BalancerPolygonReport {
    disperser: DisperseDetails
    balancer: BalancerDetails
}

const log = (message: string, debugMode = false): void => {
    if (debugMode) console.log(message)
}
/**
 * Download a report report from balancer labs repository, it contains the distribution of rewards that need to be dispersed.
 *  It downloads the report from the following URL
 * https://raw.githubusercontent.com/balancer-labs/bal-mining-scripts/master/reports/WEEK/__polygon_0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0.json
 *
 * @param {number} report  - Report number from the bal-mining-script repo. eg 79
 * @param {Object} [options={ debugMode: false }] : If debug mode is set, it logs details about the downloading process.
 * @return {Promise}  -  {Promise<Array<{ address: string, amount: string }>>}
 */
export const fetchBalancerReport = async (
    report: number,
    options = { debugMode: false },
): Promise<Array<{ address: string; amount: string }>> => {
    const url = `${REPORT_URL}/${report}/__polygon_${MTA_ADDRESS}.json`
    log(`fetchBalancerReport: get balancer-labs for report ${report}`, options.debugMode)
    log(`fetchBalancerReport: download report from url :${url}`, options.debugMode)

    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let body = ""
            res.on("data", (chunk) => {
                body += chunk
            })
            res.on("end", () => {
                try {
                    log(`fetchBalancerReport: body ${body} `, true)
                    if (body === "404: Not Found") {
                        throw new Error(body)
                    }
                    const bodyArr = Object.entries(JSON.parse(body)).map(([address, amount]) => {
                        const amountStr = typeof amount === "string" ? amount : (amount as string)
                        return { address, amount: amountStr }
                    })
                    log(`fetchBalancerReport: report contains [${bodyArr.length}] records`, options.debugMode)
                    resolve(bodyArr)
                } catch (error) {
                    log(`fetchBalancerReport: error ${error.message} `, true)
                    reject(error)
                }
            })
            res.on("error", (error) => {
                console.log("onError->", error.message)
            })
        })
    })
}

/**
 * Gets the rewards values to be disperse via DisperserForwarder of a given report, the values are scaled to match the total MTA balance.
 * @dev The Polygon MTA rewards for  will be in the __polygon_0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0.json file under the report folder with a week number.
 * eg https://github.com/balancer-labs/bal-mining-scripts/blob/master/reports/79/__polygon_0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0.json
 *  The amounts in this file assumes 15k MTA is being distributed but this will not be the case with the emissions controller.
 *  Need to proportion the MTA balance in the DisperseForwarder contract to the recipients based off the bal-mining-script report.
 *
 * @param {number} report - Report number from the bal-mining-script repo. eg 79
 *  https://github.com/balancer-labs/bal-mining-scripts/blob/master/reports/WEEK
 * @param {BN} mtaBalance - The total amount of mta to disperse, values on the report are scaled to match the total amount of MTA available
 * @param {Object} [options={ debugMode: false }] : If debug mode is set, it logs details about the downloading process.
 * @return {Promise}  {Promise<BalancerPolygonReport>}
 */
export const getBalancerPolygonReport = async (
    report: number,
    mtaBalance: BN,
    options = { debugMode: false },
): Promise<BalancerPolygonReport> => {
    const disperseRecipients = []
    const disperseValues = []
    const balancerRewards = await fetchBalancerReport(report)
    let disperseTotal = BN.from(0)
    // Balance with 18 decimals
    const balancerTotal = balancerRewards.reduce((sum, reward) => sum.add(simpleToExactAmount(reward.amount, 18)), BN.from(0))
    balancerRewards.forEach((reward) => {
        // calculate the equivalent to disperse keeping same ratio of the total reward amount
        const disperseRewardAmount = simpleToExactAmount(reward.amount, 18).mul(mtaBalance).div(balancerTotal)
        disperseRecipients.push(reward.address)
        disperseValues.push(disperseRewardAmount)
        disperseTotal = disperseTotal.add(disperseRewardAmount)
    })
    log(
        `getBalancerPolygonReport: total amount[${disperseTotal.toString()}], total count [${disperseRecipients.length}]`,
        options.debugMode,
    )
    return {
        disperser: { total: disperseTotal, recipients: disperseRecipients, values: disperseValues },
        balancer: { total: balancerTotal, rewards: balancerRewards },
    }
}
