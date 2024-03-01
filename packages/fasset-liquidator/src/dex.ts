// set up the live ecosystem
import "dotenv/config"
import { Wallet, MaxUint256, type JsonRpcProvider, type Signer } from "ethers"
import { getContracts, getBaseContracts } from "../test/integration/utils/contracts"
import { setOrUpdateDexes, dexVsFtsoPrices, removeLiquidity, swapDexPairToPrice } from "../test/integration/utils/finalization"
import type { Contracts } from "../test/integration/utils/interfaces/addresses"


export async function getDexVsFtsoPrices(
    contracts: Contracts
): Promise<void> {
    const prices = await dexVsFtsoPrices(contracts)
    console.log('prices dex1', prices.dex1[0], 'ftso', prices.dex1[1])
    console.log('prices dex2', prices.dex2[0], 'ftso', prices.dex2[1])
}

export async function setUpDexPools(
    assetManagerAddress: string,
    network: string,
    provider: JsonRpcProvider,
    supplier: Signer
): Promise<void> {
    const contracts = await getContracts(assetManagerAddress, network, provider)
    await setOrUpdateDexes(contracts, supplier, provider, true)
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
    console.log('Removing liquidity from FASSET / USDC pool')
    await removeLiquidity(contracts.uniswapV2, contracts.dex1Token, contracts.fAsset, contracts.usdc, supplier, provider)
    console.log('Removing liquidity from USDC / WNAT pool')
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
