"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const integrationData_json_1 = __importDefault(require("./integrationData.json"));
const mintTestData_json_1 = __importDefault(require("./mintTestData.json"));
const mintMultiTestData_json_1 = __importDefault(require("./mintMultiTestData.json"));
const swapTestData_json_1 = __importDefault(require("./swapTestData.json"));
const redeemTestData_json_1 = __importDefault(require("./redeemTestData.json"));
const redeemMassetTestData_json_1 = __importDefault(require("./redeemMassetTestData.json"));
const redeemExactTestData_json_1 = __importDefault(require("./redeemExactTestData.json"));
exports.default = { integrationData: integrationData_json_1.default, mintData: mintTestData_json_1.default, mintMultiData: mintMultiTestData_json_1.default, swapData: swapTestData_json_1.default, redeemData: redeemTestData_json_1.default, redeemMassetData: redeemMassetTestData_json_1.default, redeemExactData: redeemExactTestData_json_1.default };
//# sourceMappingURL=index.js.map