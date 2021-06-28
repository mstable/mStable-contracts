"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_config_1 = __importDefault(require("./hardhat.config"));
require("./tasks/deployAaveIntegration");
require("./tasks/deployBoostedSavingsVault");
require("./tasks/deployMbtc");
require("./tasks/deployFeeders");
require("./tasks/deployMV3");
require("./tasks/deployPolygon");
require("./tasks/feeder");
require("./tasks/mBTC");
require("./tasks/mUSD");
require("./tasks/SaveWrapper");
require("./tasks/FeederWrapper");
require("./tasks/ops");
require("./tasks/poker");
exports.default = hardhat_config_1.default;
//# sourceMappingURL=tasks.config.js.map