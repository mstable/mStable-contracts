/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import {
  ethers,
  EventFilter,
  Signer,
  BigNumber,
  BigNumberish,
  PopulatedTransaction,
  BaseContract,
  ContractTransaction,
  Overrides,
  CallOverrides,
} from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { Listener, Provider } from "@ethersproject/providers";
import { FunctionFragment, EventFragment, Result } from "@ethersproject/abi";
import { TypedEventFilter, TypedEvent, TypedListener } from "./commons";

interface MockBoostedSavingsVaultInterface extends ethers.utils.Interface {
  functions: {
    "boostDirector()": FunctionFragment;
    "pokeBoost(address)": FunctionFragment;
    "testGetBalance(address)": FunctionFragment;
  };

  encodeFunctionData(
    functionFragment: "boostDirector",
    values?: undefined
  ): string;
  encodeFunctionData(functionFragment: "pokeBoost", values: [string]): string;
  encodeFunctionData(
    functionFragment: "testGetBalance",
    values: [string]
  ): string;

  decodeFunctionResult(
    functionFragment: "boostDirector",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "pokeBoost", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "testGetBalance",
    data: BytesLike
  ): Result;

  events: {
    "Poked(address)": EventFragment;
    "TestGetBalance(uint256)": EventFragment;
  };

  getEvent(nameOrSignatureOrTopic: "Poked"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "TestGetBalance"): EventFragment;
}

export class MockBoostedSavingsVault extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  listeners<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter?: TypedEventFilter<EventArgsArray, EventArgsObject>
  ): Array<TypedListener<EventArgsArray, EventArgsObject>>;
  off<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  on<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  once<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  removeListener<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  removeAllListeners<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>
  ): this;

  listeners(eventName?: string): Array<Listener>;
  off(eventName: string, listener: Listener): this;
  on(eventName: string, listener: Listener): this;
  once(eventName: string, listener: Listener): this;
  removeListener(eventName: string, listener: Listener): this;
  removeAllListeners(eventName?: string): this;

  queryFilter<EventArgsArray extends Array<any>, EventArgsObject>(
    event: TypedEventFilter<EventArgsArray, EventArgsObject>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEvent<EventArgsArray & EventArgsObject>>>;

  interface: MockBoostedSavingsVaultInterface;

  functions: {
    boostDirector(overrides?: CallOverrides): Promise<[string]>;

    pokeBoost(
      _user: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    testGetBalance(
      _user: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;
  };

  boostDirector(overrides?: CallOverrides): Promise<string>;

  pokeBoost(
    _user: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  testGetBalance(
    _user: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  callStatic: {
    boostDirector(overrides?: CallOverrides): Promise<string>;

    pokeBoost(_user: string, overrides?: CallOverrides): Promise<void>;

    testGetBalance(
      _user: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;
  };

  filters: {
    Poked(user?: string | null): TypedEventFilter<[string], { user: string }>;

    TestGetBalance(
      balance?: null
    ): TypedEventFilter<[BigNumber], { balance: BigNumber }>;
  };

  estimateGas: {
    boostDirector(overrides?: CallOverrides): Promise<BigNumber>;

    pokeBoost(
      _user: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    testGetBalance(
      _user: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;
  };

  populateTransaction: {
    boostDirector(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    pokeBoost(
      _user: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    testGetBalance(
      _user: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;
  };
}
