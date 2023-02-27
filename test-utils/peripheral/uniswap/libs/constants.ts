// This file stores web3 related constants such as addresses, token definitions, ETH currency references and ABI's

import { SupportedChainId, Token } from '@uniswap/sdk-core'

// Addresses

export const POOL_FACTORY_CONTRACT_ADDRESS =
  '0x1F98431c8aD98523631AE4a59f267346ea31F984'
export const NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS =
  '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'

// Currencies and Tokens

// export const USDC_TOKEN = new Token(
//   SupportedChainId.MAINNET,
//   '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
//   6,
//   'USDC',
//   'USD//C'
// )

// export const DAI_TOKEN = new Token(
//   SupportedChainId.MAINNET,
//   '0x6B175474E89094C44Da98b954EedeAC495271d0F',
//   18,
//   'DAI',
//   'Dai Stablecoin'
// )

// Transactions

export const MAX_FEE_PER_GAS = '100000000000'
export const MAX_PRIORITY_FEE_PER_GAS = '100000000000'
export const TOKEN_AMOUNT_TO_APPROVE_FOR_TRANSFER = 1000000000000

// ABI's

export const ERC20_ABI = [
  // Read-Only Functions
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',

  // Authenticated Functions
  'function transfer(address to, uint amount) returns (bool)',
  'function approve(address _spender, uint256 _value) returns (bool)',

  // Events
  'event Transfer(address indexed from, address indexed to, uint amount)',
]

export const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  'function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) external payable override returns (address pool)',
  'function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))',
  // `function mint(MintParams calldata params) external payable override checkDeadline(params.deadline) returns ( uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`,
  // Read-Only Functions
  'function balanceOf(address _owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address _owner, uint256 _index) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string memory)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
]
