import { chai, BigNumber } from "@utils/tools";
const { expect } = chai;

/**
 * @title ExpectEvent derived from https://github.com/OpenZeppelin/openzeppelin-test-helpers
 * and translated to meet types introduced through 0x/Base-contract in ABI-gen
 */

/**
 * @dev Assert that a specific event is emitted during a transaction execution
 */
const inTransactionReceipt = async (receipt: any, eventName: string, eventArgs = {}) => {
    return inLogs(receipt.logs, eventName, eventArgs);
};

const inBlockByContract = async (
    contract: any,
    blockNumber: number,
    eventName: string,
    eventArgs = {},
) => {
    const contractEvents = await contract.getLogsAsync(
        eventName,
        {
            fromBlock: blockNumber,
            toBlock: blockNumber,
        },
        eventArgs,
    );

    expect(contractEvents.length > 0).to.equal(true, `There is no '${eventName}'`);
};

function inLogs(logs: any[], eventName: string, eventArgs = {}, shouldExist = true) {
    const events = logs.filter((e) => e["event"] === eventName);
    expect(events.length > 0).to.equal(shouldExist, `There is no '${eventName}'`);

    const exception = [];
    const event = events.find((e) => {
        for (const [k, v] of Object.entries(eventArgs)) {
            try {
                contains(e["args"], k, v);
            } catch (error) {
                exception.push(error);
                return false;
            }
        }
        return true;
    });

    if (event === undefined && shouldExist) {
        throw exception[0];
    }

    if (event !== undefined && !shouldExist) {
        throw exception[0];
    }

    return event;
}

// async function inConstruction(contract, eventName, eventArgs = {}) {
//   return inTransaction(contract.transactionHash, contract.constructor, eventName, eventArgs);
// }

function contains(args, key, value) {
    expect(key in args).to.equal(true, `Unknown event argument '${key}'`);

    if (value === null) {
        expect(args[key]).to.equal(null);
    } else if (isBigNumber(args[key])) {
        expect(args[key]).to.be.bignumber.equal(value);
    } else {
        expect(args[key]).to.be.equal(value);
    }
}

function isBigNumber(object) {
    return BigNumber.isBigNumber(object) || object instanceof BigNumber;
}

export { inLogs, inBlockByContract, inTransactionReceipt };
