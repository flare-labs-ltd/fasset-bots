// set up the live ecosystem
require('dotenv').config()
import { ethers } from "ethers"
import { getContracts, getBaseContracts } from "../test/integration/helpers/contracts"
import { syncDexReservesWithFtsoPrices, dexVsFtsoPrices } from "../test/integration/helpers/utils"

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

const network = "coston"
const provider = new ethers.JsonRpcProvider("https://coston-api.flare.network/ext/C/rpc")
//const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")
const SUPPLIER_PVK = process.env.FUND_SUPPLIER_PRIVATE_KEY_1!
const supplier = new ethers.Wallet(SUPPLIER_PVK, provider)
const assetManagerAddress = "0x93CF4820d35Fff1afd44aD54546649D8D2b8e952"

getDexVsFtsoPrices(assetManagerAddress)
//setUpDex(assetManagerAddress, network, provider, supplier)