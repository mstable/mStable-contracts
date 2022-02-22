import { CLIArgumentType } from "hardhat/src/types/index"
import { isValidAddress } from "ethereumjs-util"
import { HardhatError } from "hardhat/internal/core/errors"
import { ERRORS } from "hardhat/internal/core/errors-list"

/**
 * Hardhat task CLI argument types
 */
export const params = {
    address: {
        name: "address",
        parse: (argName, strValue) => strValue,
        validate: (argName: string, value: unknown): void => {
            const isValid = typeof value === "string" && isValidAddress(value)

            if (!isValid) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: "address",
                })
            }
        },
    } as CLIArgumentType<string>,
    addressArray: {
        name: "address[]",
        parse: (argName, strValue) => strValue.split(","),
        validate: (argName: string, value: unknown): void => {
            const isValid = Array.isArray(value) && value.every(isValidAddress)

            if (!isValid) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: "address[]",
                })
            }
        },
    } as CLIArgumentType<string[]>,
}
