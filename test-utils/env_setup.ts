/// <reference path="../types/interfaces.d.ts" />

import * as chai from "chai";
import ChaiBigNumber = require("chai-bignumber");

/**
 * @notice This file configures the environment for testing
 */
class TestEnvironmentSetup {
    private isConfigured: boolean;

    constructor() {
        this.isConfigured = false;
    }

    public configure() {
        if (this.isConfigured) {
            return;
        }

        chai.use(ChaiBigNumber());
        this.isConfigured = true;
    }
}

export default new TestEnvironmentSetup();
