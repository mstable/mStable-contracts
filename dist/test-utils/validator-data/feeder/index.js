"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fPoolIntegrationData_json_1 = __importDefault(require("./fPoolIntegrationData.json"));
const fPoolMintData_json_1 = __importDefault(require("./fPoolMintData.json"));
const fPoolMintMultiData_json_1 = __importDefault(require("./fPoolMintMultiData.json"));
const fPoolSwapData_json_1 = __importDefault(require("./fPoolSwapData.json"));
const fPoolRedeemData_json_1 = __importDefault(require("./fPoolRedeemData.json"));
const fPoolRedeemProportionalData_json_1 = __importDefault(require("./fPoolRedeemProportionalData.json"));
const fPoolRedeemMultiData_json_1 = __importDefault(require("./fPoolRedeemMultiData.json"));
exports.default = { integrationData: fPoolIntegrationData_json_1.default, mintData: fPoolMintData_json_1.default, mintMultiData: fPoolMintMultiData_json_1.default, swapData: fPoolSwapData_json_1.default, redeemData: fPoolRedeemData_json_1.default, redeemProportionalData: fPoolRedeemProportionalData_json_1.default, redeemExactData: fPoolRedeemMultiData_json_1.default };
//# sourceMappingURL=index.js.map