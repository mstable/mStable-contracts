import { Address } from "../../types/common";
import { BigNumber } from "../tools";
import { DEFAULT_DECIMALS, DEFAULT_SUPPLY } from "../constants";

import {
  ERC20MockContract,
} from "../contracts";

const ERC20Artifact = artifacts.require("ERC20Mock");

export class BassetMachine {
  private deployer: Address;
  private TX_DEFAULTS: any;

  constructor(deployer: Address, defaultSender: Address, defaultGas: number = 500000) {
    this.deployer = deployer;
    this.TX_DEFAULTS = {
      from: defaultSender,
      gas: defaultGas,
    };
  }

  public async deployERC20Async(
    name: string = "BassetMock",
    symbol: string = "BMT",
    decimals: BigNumber = DEFAULT_DECIMALS,
    initialRecipient: Address = this.deployer,
    initialMint: BigNumber = DEFAULT_SUPPLY,
  ): Promise<ERC20MockContract> {
    const mockInstance = await ERC20Artifact.new(
      name,
      symbol,
      decimals,
      initialRecipient,
      initialMint,
      { from: this.deployer },
    );

    return new ERC20MockContract(
      mockInstance.address,
      web3.currentProvider,
      this.TX_DEFAULTS,
    );
  }

  // public async deployTokensAsync(
  //   tokenCount: number,
  //   initialAccount: Address,
  // ): Promise<StandardTokenMockContract[]> {
  //   const mockTokens: StandardTokenMockContract[] = [];
  //   const mockTokenPromises = _.times(tokenCount, async index => {
  //     return await StandardTokenMock.new(
  //       initialAccount,
  //       DEPLOYED_TOKEN_QUANTITY,
  //       `Component ${index}`,
  //       index.toString(),
  //       _.random(4, 18),
  //       { from: this._senderAccountAddress, gas: DEFAULT_GAS },
  //     );
  //   });

  //   await Promise.all(mockTokenPromises).then(tokenMocks => {
  //     _.each(tokenMocks, standardToken => {
  //       mockTokens.push(new StandardTokenMockContract(
  //         new web3.eth.Contract(standardToken.abi, standardToken.address),
  //         { from: this._senderAccountAddress }
  //       ));
  //     });
  //   });

  //   return mockTokens;
  // }
}
