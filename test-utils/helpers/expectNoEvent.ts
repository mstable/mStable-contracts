import { TransactionReceiptWithDecodedLogs } from "ethereum-types";
import { inLogs } from "./expectEvent";

/**
 * @title ExpectEvent derived from https://github.com/OpenZeppelin/openzeppelin-test-helpers
 * and translated to meet types introduced through 0x/Base-contract in ABI-gen
 */

/**
 * @dev Assert that a specific event is emitted during a transaction execution
 */
const inTransactionReceipt = async (receipt: TransactionReceiptWithDecodedLogs, eventName: string, eventArgs = {}) => {
  return inLogs(receipt.logs, eventName, eventArgs, false);
};

export {
  inTransactionReceipt,
};
