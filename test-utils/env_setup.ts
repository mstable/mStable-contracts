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

    // Forces compliance with 0x BaseContract `Provider` type
    if (web3.currentProvider["send"]) {
      web3.currentProvider["sendAsync"] = web3.currentProvider["send"];
    }

    chai.use(ChaiBigNumber());
    this.isConfigured = true;
  }
}

export default new TestEnvironmentSetup();
