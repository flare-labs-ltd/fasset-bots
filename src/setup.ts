// set up the live ecosystem
require('dotenv').config()
import { ethers } from "ethers"
import { getContracts, getBaseContracts } from "../test/integration/helpers/contracts"
import { initFtsoSyncedDexReserves } from "../test/integration/helpers/utils"


async function setUpDex(
  assetManagerAddress: string,
  network: string,
  provider: ethers.JsonRpcProvider,
  supplier: ethers.Wallet
): Promise<void> {
  const contracts = await getContracts(assetManagerAddress, network, provider)
  await initFtsoSyncedDexReserves(contracts, supplier, provider)
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
const SUPPLIER_PVK = process.env.FUND_SUPPLIER_PRIVATE_KEY!
const supplier = new ethers.Wallet(SUPPLIER_PVK, provider)
const assetManagerAddress = ""

setUpDex(assetManagerAddress, network, provider, supplier)