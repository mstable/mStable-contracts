// This file contains code to easily connect to and get information from a wallet on chain

import { Currency } from '@uniswap/sdk-core'
import { ethers } from 'ethers'
import { ERC20_ABI } from './constants'
import { toReadableAmount } from './conversion'

export async function getCurrencyBalance(
  provider: ethers.providers.Provider,
  address: string,
  currency: Currency
): Promise<string> {
  // Handle ETH directly
  if (currency.isNative) {
    return ethers.utils.formatEther(await provider.getBalance(address))
  }

  // Get currency otherwise
  const currencyContract = new ethers.Contract(
    currency.address,
    ERC20_ABI,
    provider
  )
  const balance: number = await currencyContract.balanceOf(address)
  const decimals: number = await currencyContract.decimals()

  // Format with proper units (approximate)
  return toReadableAmount(balance, decimals).toString()
}
