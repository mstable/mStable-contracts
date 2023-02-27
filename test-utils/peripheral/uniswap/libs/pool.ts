import { ethers, Signer } from 'ethers'
// import { CurrentConfig } from '../config'
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import IUniswapV3PoolFactoryABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json'
import { POOL_FACTORY_CONTRACT_ADDRESS } from './constants'
// import { getProvider } from './providers'
import { computePoolAddress } from '@uniswap/v3-sdk'
import { MintPositionConfig } from './positions'

interface PoolInfo {
  poolAddress:string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
  sqrtPriceX96: ethers.BigNumber
  liquidity: ethers.BigNumber
  tick: number
}

export async function getPoolInfo(signer: Signer,CurrentConfig:MintPositionConfig): Promise<PoolInfo> {
  // const provider = getProvider()
  // if (!provider) {
  //   throw new Error('No provider')
  // }
  const provider = signer;

  const currentPoolAddress = computePoolAddress({
    factoryAddress: POOL_FACTORY_CONTRACT_ADDRESS,
    tokenA: CurrentConfig.tokens.token0,
    tokenB: CurrentConfig.tokens.token1,
    fee: CurrentConfig.tokens.poolFee,
  })

  const poolContract = new ethers.Contract(
    currentPoolAddress,
    IUniswapV3PoolABI.abi,
    provider
  )

  const [token0, token1, fee, tickSpacing, liquidity, slot0] =
    await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.tickSpacing(),
      poolContract.liquidity(),
      poolContract.slot0(),
    ])

  return {
    poolAddress: currentPoolAddress,
    token0,
    token1,
    fee,
    tickSpacing,
    liquidity,
    sqrtPriceX96: slot0[0],
    tick: slot0[1],
  }
}

export async function createPool(signer: Signer,CurrentConfig:MintPositionConfig): Promise<void> {
  console.log("-----------createPool--------------")

  const provider = signer;

  const poolFactoryContract = new ethers.Contract(
    POOL_FACTORY_CONTRACT_ADDRESS,
    IUniswapV3PoolFactoryABI.abi,
    provider
  )
  await poolFactoryContract.createPool(
    CurrentConfig.tokens.token0.address,
    CurrentConfig.tokens.token1.address,
    CurrentConfig.tokens.poolFee
  )
}


