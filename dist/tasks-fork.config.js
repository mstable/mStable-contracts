"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_fork_config_1 = __importDefault(require("./hardhat-fork.config"));
require("./tasks/deployAaveIntegration");
require("./tasks/deployMbtc");
require("./tasks/deployMV3");
require("./tasks/deployFeeders");
require("./tasks/feeder");
require("./tasks/mBTC");
require("./tasks/mUSD");
exports.default = hardhat_fork_config_1.default;
//# sourceMappingURL=tasks-fork.config.js.map