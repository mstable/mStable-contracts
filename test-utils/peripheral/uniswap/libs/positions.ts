import { Signer } from "ethers"
import {  Provider } from "@ethersproject/abstract-provider";
import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import {
  FeeAmount,
  MintOptions,
  nearestUsableTick,
  NonfungiblePositionManager,
  Pool,
  Position,
} from '@uniswap/v3-sdk'
import { BigNumber, ethers } from 'ethers'
// import { mintPositionConfig } from '../config'
import {
  ERC20_ABI,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
} from './constants'
import { TOKEN_AMOUNT_TO_APPROVE_FOR_TRANSFER } from './constants'
import { fromReadableAmount } from './conversion'
import { getPoolInfo } from './pool'
// import {
//   getProvider,
//   getWalletAddress,
//   sendTransaction,
//   TransactionState,
// } from './providers'

export interface PositionInfo {
  tickLower: number
  tickUpper: number
  liquidity: BigNumber
  feeGrowthInside0LastX128: BigNumber
  feeGrowthInside1LastX128: BigNumber
  tokensOwed0: BigNumber
  tokensOwed1: BigNumber
}

export interface MintPositionConfig {
  tokens: {
    token0:Token, 
    token0Amount: number,
    token1:Token,
    token1Amount: number,
    poolFee:FeeAmount
  }
}
export async function mintPosition(signer: Signer,mintPositionConfig:MintPositionConfig): Promise<TransactionState> {
  // const address = getWalletAddress()
  // const provider = getProvider()
  // if (!address || !provider) {
  //   return TransactionState.Failed
  // }
  console.log("-----------mintPosition--------------")
  const address = await signer.getAddress();

  // Give approval to the contract to transfer tokens
  const tokenInApproval = await getTokenTransferApproval(signer,
    mintPositionConfig.tokens.token0
  )
  const tokenOutApproval = await getTokenTransferApproval(signer,
    mintPositionConfig.tokens.token1
    )

  // Fail if transfer approvals do not go through
  if (
    tokenInApproval !== TransactionState.Sent ||
    tokenOutApproval !== TransactionState.Sent
  ) {
    return TransactionState.Failed
  }
  console.log("-----------constructPosition--------------")
  const positionToMint = await constructPosition(signer,mintPositionConfig,
    CurrencyAmount.fromRawAmount(
      mintPositionConfig.tokens.token0,
      fromReadableAmount(
        mintPositionConfig.tokens.token0Amount,
        mintPositionConfig.tokens.token0.decimals
      )
    ),
    CurrencyAmount.fromRawAmount(
      mintPositionConfig.tokens.token1,
      fromReadableAmount(
        mintPositionConfig.tokens.token1Amount,
        mintPositionConfig.tokens.token1.decimals
      )
    )
  )

  const mintOptions: MintOptions = {
    recipient: address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    slippageTolerance: new Percent(50, 10_000),
  }

  // get calldata for minting a position
  console.log("-----------positionToMint--------------")
  console.log(`
  token0PriceUpper: ${positionToMint.token0PriceUpper.toFixed()}
  token0PriceLower: ${positionToMint.token0PriceLower.toFixed()}
  amount0:          ${positionToMint.amount0.toFixed()}
  amount1:          ${positionToMint.amount1.toFixed()}
  `)
  console.log(JSON.stringify(positionToMint));
  console.log(JSON.stringify(mintOptions));

  console.log("-----------addCallParameters--------------")
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    positionToMint,
    mintOptions
  )
  console.log("calldata",JSON.stringify(calldata));
  console.log("value",JSON.stringify(value));

  // build transaction
  const transaction = {
    data: calldata,
    to: NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
    value: value,
    from: address,
    maxFeePerGas: MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
  }

  return sendTransaction(signer,transaction)
}

export async function constructPosition(
  signer:Signer,
  mintPositionConfig:MintPositionConfig,
  token0Amount: CurrencyAmount<Token>,
  token1Amount: CurrencyAmount<Token>
): Promise<Position> {
  console.log("🚀 ~ file: positions.ts:130 ~ token1Amount:", token1Amount)
  console.log("🚀 ~ file: positions.ts:130 ~ token0Amount:", token0Amount)
  // get pool info
  const poolInfo = await getPoolInfo(signer,mintPositionConfig)

  // construct pool instance
  const configuredPool = new Pool(
    token0Amount.currency,
    token1Amount.currency,
    poolInfo.fee,
    poolInfo.sqrtPriceX96.toString(),
    poolInfo.liquidity.toString(),
    poolInfo.tick
  )

  // create position using the maximum liquidity from input amounts
  return Position.fromAmounts({
    pool: configuredPool,
    tickLower:
      nearestUsableTick(poolInfo.tick, poolInfo.tickSpacing) -
      poolInfo.tickSpacing * 2,
    tickUpper:
      nearestUsableTick(poolInfo.tick, poolInfo.tickSpacing) +
      poolInfo.tickSpacing * 2,
    amount0: token0Amount.quotient,
    amount1: token1Amount.quotient,
    useFullPrecision: true,
  })
}
export async function mintRawPosition(signer: Signer,CurrentConfig:MintPositionConfig): Promise<void> {
  console.log("-----------createAndInitializePoolIfNecessary--------------")

  const provider = signer;

  const positionContract = new ethers.Contract(
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    provider
  )
  await positionContract.mint([
    CurrentConfig.tokens.token0.address,
    CurrentConfig.tokens.token1.address,
    CurrentConfig.tokens.poolFee,
    "390431578644343634535642476"
  ]
  )
}
export async function createAndInitializePoolIfNecessary(signer: Signer,CurrentConfig:MintPositionConfig): Promise<void> {
  console.log("-----------createAndInitializePoolIfNecessary--------------")

  const provider = signer;

  const positionContract = new ethers.Contract(
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    provider
  )
  await positionContract.createAndInitializePoolIfNecessary(
    CurrentConfig.tokens.token0.address,
    CurrentConfig.tokens.token1.address,
    CurrentConfig.tokens.poolFee,
    "390431578644343634535642476"
  )
}

export async function getPositionIds(signer: Signer): Promise<number[]> {
  // const provider = getProvider()
  // const address = getWalletAddress()
  // if (!provider || !address) {
  //   throw new Error('No provider available')
  // }
  const provider = signer;
  const address = await signer.getAddress();

  const positionContract = new ethers.Contract(
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    provider
  )

  // Get number of positions
  const balance: number = await positionContract.balanceOf(address)

  // Get all positions
  const tokenIds = []
  for (let i = 0; i < balance; i++) {
    const tokenOfOwnerByIndex: number =
      await positionContract.tokenOfOwnerByIndex(address, i)
    tokenIds.push(tokenOfOwnerByIndex)
  }

  return tokenIds
}

export async function getPositionInfo(signer: Signer, tokenId: number): Promise<PositionInfo> {
  // const provider = getProvider()
  // if (!provider) {
  //   throw new Error('No provider available')
  // }
  const provider = signer;


  const positionContract = new ethers.Contract(
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    provider
  )

  const position = await positionContract.positions(tokenId)

  return {
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity,
    feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
    feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
    tokensOwed0: position.tokensOwed0,
    tokensOwed1: position.tokensOwed1,
  }
}

export async function getTokenTransferApproval(
  signer: Signer,
  token: Token
): Promise<TransactionState> {
  // const provider = getProvider()
  // const address = getWalletAddress()
  // if (!provider || !address) {
  //   console.log('No Provider Found')
  //   return TransactionState.Failed
  // }
  const provider = signer;
  const address = await signer.getAddress();

  try {
    const tokenContract = new ethers.Contract(
      token.address,
      ERC20_ABI,
      provider
    )

    const transaction = await tokenContract.populateTransaction.approve(
      NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
      TOKEN_AMOUNT_TO_APPROVE_FOR_TRANSFER
    )

    return sendTransaction(signer, {
      ...transaction,
      from: address,
    })
  } catch (e) {
    console.error(e)
    return TransactionState.Failed
  }
}
export async function sendTransaction(signer:Signer,
  transaction: ethers.providers.TransactionRequest
): Promise<TransactionState> {
  return sendTransactionViaSigner(signer, transaction);
}

export enum TransactionState {
  Failed = 'Failed',
  New = 'New',
  Rejected = 'Rejected',
  Sending = 'Sending',
  Sent = 'Sent',
}

async function sendTransactionViaSigner(signer:Signer,
  transaction: ethers.providers.TransactionRequest
): Promise<TransactionState> {
  if (transaction.value) {
    transaction.value = BigNumber.from(transaction.value)
  }
  const txRes = await signer.sendTransaction(transaction)
  

  let receipt =  null;


    try {
      receipt = txRes.wait();
    } catch (e) {
      console.log(`Receipt error:`, e)
    }


  // Transaction was successful if status === 1
  if (receipt) {
    return TransactionState.Sent
  } else {
    return TransactionState.Failed
  }
}
