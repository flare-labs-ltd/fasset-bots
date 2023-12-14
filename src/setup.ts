// set up the live ecosystem
import "dotenv/config"
import { ethers } from "ethers"
import { getContracts, getBaseContracts } from "../test/integration/helpers/contracts"
import { syncDexReservesWithFtsoPrices, dexVsFtsoPrices, removeLiquidity, swapDexPairToPrice } from "../test/integration/helpers/utils"

async function getDexVsFtsoPrices(assetManagerAddress: string): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  const prices = await dexVsFtsoPrices(contracts)
  console.log('prices dex1', prices.dex1[0], 'ftso', prices.dex1[1])
  console.log('prices dex2', prices.dex2[0], 'ftso', prices.dex2[1])
}

async function setUpDex(
  assetManagerAddress: string,
  network: string,
  provider: ethers.JsonRpcProvider,
  supplier: ethers.Wallet
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  await syncDexReservesWithFtsoPrices(contracts, supplier, provider, true)
  await getDexVsFtsoPrices(assetManagerAddress)
}

async function fixDex(
  assetManagerAddress: string,
  network: string,
  provider: ethers.JsonRpcProvider,
  supplier: ethers.Wallet
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  const { 0: priceXrp } = await contracts.priceReader.getPrice("testXRP")
  const { 0: priceUsdc } = await contracts.priceReader.getPrice("testUSDC")
  await swapDexPairToPrice(
    contracts,
    contracts.fAsset, contracts.usdc,
    priceXrp, priceUsdc,
    ethers.MaxUint256,
    ethers.MaxUint256,
    supplier, provider
  )
  await getDexVsFtsoPrices(assetManagerAddress)
}

async function removeDexLiquidity(
  assetManagerAddress: string,
  network: string,
  provider: ethers.JsonRpcProvider,
  supplier: ethers.Wallet
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  await removeLiquidity(contracts.blazeSwapRouter, contracts.dex1Token, contracts.fAsset, contracts.usdc, supplier, provider)
  await removeLiquidity(contracts.blazeSwapRouter, contracts.dex2Token, contracts.usdc, contracts.wNat, supplier, provider)
  const wrappedNat = await contracts.wNat.balanceOf(supplier.address)
  console.log(`Unwrapping ${wrappedNat} wNat`)
  await contracts.wNat.connect(supplier).withdraw(wrappedNat)
}

async function setUpFlashLender(
  network: string,
  provider: ethers.JsonRpcProvider,
  supplier: ethers.Wallet
): Promise<void> {
  const contracts = getBaseContracts(network, provider)
  const balance = await contracts.usdc.balanceOf(supplier.address)
  await contracts.usdc.connect(supplier).transfer(contracts.flashLender, balance)
}

const network = process.env.NETWORK!
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
//const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")
const SUPPLIER_PVK = process.env.FUND_SUPPLIER_PRIVATE_KEY_1!
const supplier = new ethers.Wallet(SUPPLIER_PVK, provider)
const assetManagerAddress = "0xEB9900EB5fB4eC73EF177e1904f80F1F589D9d5f"

//setUpFlashLender(network, provider, supplier)
setUpDex(assetManagerAddress, network, provider, supplier)
//removeDexLiquidity(assetManagerAddress, network, provider, supplier)
//getDexVsFtsoPrices(assetManagerAddress)