import { WeiPerEther, type JsonRpcProvider, type Signer } from "ethers"
import { waitFinalize } from "../finalization"
import { removeLiquidity } from "./wrappers"
import { syncDexReservesWithFtsoPrices } from "./price-sync"
import { FTSO_SYMBOLS } from "../../../constants"
import type { IERC20Metadata } from "../../../../types"
import type { BaseContracts, Contracts } from "../interfaces/contracts"


const COSTON_FTSO_SYMBOLS = FTSO_SYMBOLS["coston"]

export function getCollateralInfo(contracts: BaseContracts): [IERC20Metadata, string][] {
    return [
        [contracts.collaterals.usdc, COSTON_FTSO_SYMBOLS.USDC],
        [contracts.collaterals.usdt, COSTON_FTSO_SYMBOLS.USDT],
        [contracts.collaterals.weth, COSTON_FTSO_SYMBOLS.WETH]
    ]
}

/**
  * A high level function to set up the dex ecosystem
  * for both USDC/F-Asset and WNAT/USDC pairs.
  */
export async function setOrUpdateDexes(
    contracts: Contracts,
    signer: Signer,
    provider: JsonRpcProvider,
    wrapNat = false
): Promise<void> {
    if (wrapNat) {
        // wrap user nat
        const leftoverNat = BigInt(100) * WeiPerEther
        const availableNat = await provider.getBalance(signer)
        if (availableNat > leftoverNat) {
            const wrapNat = availableNat - leftoverNat
            await waitFinalize(provider, signer, contracts.wNat.connect(signer).deposit({ value: wrapNat }))
        }
    }
    // we have only those F-Assets and CFLRs available
    const availableFAsset = await contracts.fAsset.balanceOf(signer)
    const availableWNat = await contracts.wNat.balanceOf(signer)
    // align prices on all the needed dex pairs
    const collateralInfo = getCollateralInfo(contracts)
    const ncollaterals = collateralInfo.length
    for (let [collateralToken, collateralSymbol] of collateralInfo) {
        const availableCollateralToken = await collateralToken.balanceOf(signer)
        await syncDexReservesWithFtsoPrices(
            contracts, collateralToken, contracts.fAsset, collateralSymbol, COSTON_FTSO_SYMBOLS.WNAT,
            availableCollateralToken / BigInt(2), availableFAsset / BigInt(ncollaterals),
            signer, provider, true
        )
        await syncDexReservesWithFtsoPrices(
            contracts, collateralToken, contracts.wNat, collateralSymbol, COSTON_FTSO_SYMBOLS.WNAT,
            availableCollateralToken / BigInt(2), availableWNat / BigInt(ncollaterals),
            signer, provider, true
        )
    }
}

export async function removeAllLiquidity(
    contracts: Contracts,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    // remove liquidity from all dexes
    for (let [collateralToken,] of getCollateralInfo(contracts)) {
        await removeLiquidity(contracts.uniswapV2, collateralToken, contracts.fAsset, signer, provider)
        await removeLiquidity(contracts.uniswapV2, collateralToken, contracts.wNat, signer, provider)
    }
    // unwrap wnat
    const wNatBalance = await contracts.wNat.balanceOf(signer)
    if (wNatBalance > BigInt(0)) {
        await waitFinalize(provider, signer, contracts.wNat.connect(signer).withdraw(wNatBalance))
    }
}

export async function dexVsFtsoPrices(contracts: Contracts): Promise<{
    'dex1': [bigint, bigint],
    'dex2': [bigint, bigint],
}> {
    // get ftso prices of all relevant symbols
    const { 0: usdcPrice } = await contracts.priceReader.getPrice(COSTON_FTSO_SYMBOLS.USDC)
    const { 0: wNatPrice } = await contracts.priceReader.getPrice(COSTON_FTSO_SYMBOLS.WNAT)
    const { 0: assetPrice } = await contracts.priceReader.getPrice(COSTON_FTSO_SYMBOLS.TEST_XRP)
    const ftsoPrice1 = BigInt(10_000) * usdcPrice / assetPrice
    const ftsoPrice2 = BigInt(10_000) * wNatPrice / usdcPrice
    // get dex reserves
    const [dex1FAsset, dex1Usdc] = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.collaterals.usdc)
    const [dex2WNat, dex2Usdc] = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.collaterals.usdc)
    const dexPrice1 = BigInt(10_000) * dex1FAsset * BigInt(1e12) / dex1Usdc
    const dexPrice2 = BigInt(10_000) * dex2Usdc / dex2WNat
    return {
        'dex1': [dexPrice1, ftsoPrice1],
        'dex2': [dexPrice2, ftsoPrice2],
    }
}