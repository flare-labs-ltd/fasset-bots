// set up the live ecosystem
import "dotenv/config"
import { Wallet, MaxUint256,JsonRpcProvider } from "ethers"
import { getContracts, getBaseContracts } from "../test/integration/helpers/contracts"
import { syncDexReservesWithFtsoPrices, dexVsFtsoPrices, removeLiquidity, swapDexPairToPrice } from "../test/integration/helpers/utils"
import type { Signer } from "ethers"
import type { Contracts } from "../test/integration/helpers/interface"


export async function getDexVsFtsoPrices(
  contracts: Contracts
): Promise<void> {
  const prices = await dexVsFtsoPrices(contracts)
  console.log('prices dex1', prices.dex1[0], 'ftso', prices.dex1[1])
  console.log('prices dex2', prices.dex2[0], 'ftso', prices.dex2[1])
}

export async function setUpDex(
  assetManagerAddress: string,
  network: string,
  provider: JsonRpcProvider,
  supplier: Signer
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  await syncDexReservesWithFtsoPrices(contracts, supplier, provider, true)
  await getDexVsFtsoPrices(contracts)
}

export async function fixDex(
  assetManagerAddress: string,
  network: string,
  provider: JsonRpcProvider,
  supplier: Signer
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  const { 0: priceXrp } = await contracts.priceReader.getPrice("testXRP")
  const { 0: priceUsdc } = await contracts.priceReader.getPrice("testUSDC")
  await swapDexPairToPrice(
    contracts,
    contracts.fAsset, contracts.usdc,
    priceXrp, priceUsdc,
    MaxUint256,
    MaxUint256,
    supplier, provider
  )
  await getDexVsFtsoPrices(contracts)
}

export async function removeDexLiquidity(
  assetManagerAddress: string,
  network: string,
  provider: JsonRpcProvider,
  supplier: Wallet
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  await removeLiquidity(contracts.uniswapV2, contracts.dex1Token, contracts.fAsset, contracts.usdc, supplier, provider)
  await removeLiquidity(contracts.uniswapV2, contracts.dex2Token, contracts.usdc, contracts.wNat, supplier, provider)
  const wrappedNat = await contracts.wNat.balanceOf(supplier.address)
  console.log(`Unwrapping ${wrappedNat} wNat`)
  await contracts.wNat.connect(supplier).withdraw(wrappedNat)
}

export async function setUpFlashLender(
  network: string,
  provider: JsonRpcProvider,
  supplier: Wallet
): Promise<void> {
  const contracts = getBaseContracts(network, provider)
  const balance = await contracts.usdc.balanceOf(supplier.address)
  await contracts.usdc.connect(supplier).transfer(contracts.flashLender, balance)
}