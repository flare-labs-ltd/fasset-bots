import { WeiPerEther, MaxUint256 } from "ethers"
import { priceBasedAddedDexReserves, swapToDexPrice, assetPriceForAgentCr } from "../../calculations"
import type { AddressLike, Signer, JsonRpcProvider, ContractTransactionResponse, ContractTransactionReceipt } from "ethers"
import type { IUniswapV2Router, IERC20Metadata, IUniswapV2Pair, ERC20, IWNat, IERC20 } from "../../../types"
import type { Contracts } from "./interface"

/////////////////////////////////////////////////////////////////////////
// general functions

async function sleep(milliseconds: number) {
    await new Promise((resolve: any) => {
        setTimeout(() => {
            resolve()
        }, milliseconds)
    })
}

/////////////////////////////////////////////////////////////////////////
// ethers specific

export async function waitFinalize(
    provider: JsonRpcProvider,
    signer: Signer,
    prms: Promise<ContractTransactionResponse>
): Promise<ContractTransactionReceipt> {
    const signerAddress = await signer.getAddress()
    const nonce = await provider.getTransactionCount(signer)
    let response
    try {
        response = ((await prms).wait())
    } catch {
        response = await prms
        await sleep(5_000)
    }
    while ((await provider.getTransactionCount(signerAddress)) === nonce) {
        await sleep(100)
    }
    return response as any
}

/////////////////////////////////////////////////////////////////////////
// F-Asset specific

// obtains the f-assets's price that results in agent having collateral ratio of crBips
export async function getCollateralPriceForAgentCr(
    contracts: Contracts,
    agentAddress: AddressLike,
    crBips: number,
    collateralToken: IERC20Metadata,
    collateralSymbol: string,
    fAssetSymbol: string,
    collateralKind: "vault" | "pool",
): Promise<bigint> {
    const agentInfo = await contracts.assetManager.getAgentInfo(agentAddress)
    const totalMintedUBA = agentInfo.mintedUBA + agentInfo.redeemingUBA + agentInfo.reservedUBA
    const collateralWei = collateralKind === "vault" ? agentInfo.totalVaultCollateralWei : agentInfo.totalPoolCollateralNATWei
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await contracts.priceReader.getPrice(collateralSymbol)
    const { 2: fAssetFtsoDecimals } = await contracts.priceReader.getPrice(fAssetSymbol)
    return assetPriceForAgentCr(
        BigInt(crBips),
        totalMintedUBA,
        collateralWei,
        collateralFtsoPrice,
        collateralFtsoDecimals,
        await collateralToken.decimals(),
        fAssetFtsoDecimals,
        await contracts.fAsset.decimals()
    )
}

/////////////////////////////////////////////////////////////////////////
// ecosystem setup and manipulation

export async function dexVsFtsoPrices(contracts: Contracts): Promise<{
    'dex1': [bigint, bigint],
    'dex2': [bigint, bigint],
}> {
    // get ftso prices of all relevant symbols
    const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
    const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
    const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
    const ftsoPrice1 = BigInt(10_000) * usdcPrice / assetPrice
    const ftsoPrice2 = BigInt(10_000) * wNatPrice / usdcPrice
    // get dex reserves
    const [dex1FAsset, dex1Usdc] = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.usdc)
    const [dex2WNat, dex2Usdc] = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.usdc)
    const dexPrice1 = BigInt(10_000) * dex1FAsset * BigInt(1e12) / dex1Usdc
    const dexPrice2 = BigInt(10_000) * dex2Usdc / dex2WNat
    return {
        'dex1': [dexPrice1, ftsoPrice1],
        'dex2': [dexPrice2, ftsoPrice2],
    }
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
            const ccall = contracts.wNat.connect(signer).deposit({ value: wrapNat })
            await waitFinalize(provider, signer, ccall)
        }
    }
    // we have only those F-Assets and CFLRs available
    const availableFAsset = await contracts.fAsset.balanceOf(signer)
    const availableWNat = await contracts.wNat.balanceOf(signer)
    // align prices on all the needed dex pairs
    const collaterals: [IERC20Metadata, string][] = [
        [contracts.usdc, "testUSDC"],
        [contracts.usdt, "testUSDT"],
        [contracts.eth, "testETH"]
    ]
    const ncollaterals = collaterals.length
    for (let [collateralToken, collateralSymbol] of collaterals) {
        const availableCollateralToken = await collateralToken.balanceOf(signer)
        await syncDexReservesWithFtsoPrices(
            contracts, contracts.usdc, contracts.fAsset, collateralSymbol, "CFLR",
            availableCollateralToken / BigInt(2), availableFAsset / BigInt(ncollaterals),
            signer, provider, true
        )
        await syncDexReservesWithFtsoPrices(
            contracts, contracts.usdc, contracts.wNat, collateralSymbol, "CFLR",
            availableCollateralToken / BigInt(2), availableWNat / BigInt(ncollaterals),
            signer, provider, true
        )
    }
}

export async function syncDexReservesWithFtsoPrices(
    contracts: Contracts,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    maxAddedA: bigint,
    maxAddedB: bigint,
    signer: Signer,
    provider: JsonRpcProvider,
    addInitialLiquidity?: boolean
): Promise<void> {
    // get ftso prices of all relevant symbols
    const { 0: priceA } = await contracts.priceReader.getPrice(symbolA)
    const { 0: priceB } = await contracts.priceReader.getPrice(symbolB)
    // align f-asset/usdc and wNat/usdc dex prices with the ftso with available balances
    // by swapping
    const { 0: reserveA, 1: reserveB } = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    if ((reserveA == BigInt(0) || reserveB == BigInt(0)) && addInitialLiquidity) {
        // if there are no reserves add liquidity first (also no need to swap)
        await addLiquidityToDexPairPrice(
            contracts.uniswapV2, tokenA, tokenB, priceA, priceB,
            maxAddedA, maxAddedB, signer, provider
        )
    } else if (reserveA > BigInt(0) && reserveB > BigInt(0)) {
        // if there are reserves swap first, then add liquidity
        await swapDexPairToPrice(contracts, tokenA, tokenB, priceA, priceB, maxAddedA, maxAddedB, signer, provider)
    } else {
        console.error('sync dex reserves failure: no reserves to sync')
    }
}

// (TODO: do not assume that 5 ftso decimals)
// set dex price of tokenA in tokenB by adding liquidity.
// both prices in the same currency, e.g. FLR/$, XRP/$
async function addLiquidityToDexPairPrice(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    priceA: bigint,
    priceB: bigint,
    maxAddedA: bigint,
    maxAddedB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    let reserveA = BigInt(0)
    let reserveB = BigInt(0)
    try {
        [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
    } catch {
        // means there's no reserves for the dex pair
    }
    let [addedA, addedB] = priceBasedAddedDexReserves(
        reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxAddedA, maxAddedB)
    if (addedA < 0) addedA = BigInt(0) // ideally we would need to remove liquidity
    if (addedB < 0) addedB = BigInt(0) // but user may not have any, so we leave it
    if (addedA == BigInt(0) && addedB == BigInt(0)) {
        console.error('add liquidity failure: no reserves can be added')
    } else {
        await addLiquidity(uniswapV2, tokenA, tokenB, addedA, addedB, signer, provider)
    }
}

// swap on dexes to achieve the given price
export async function swapDexPairToPrice(
    contracts: Contracts,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    priceA: bigint,
    priceB: bigint,
    maxSwapA: bigint,
    maxSwapB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    // align dex prices with the ftso prices while not exceeding available balances
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const [reserveA, reserveB] = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    let swapA = swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB)
    if (swapA > maxSwapA) swapA = maxSwapA
    let swapB = swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA)
    if (swapB > maxSwapB) swapB = maxSwapB
    if (swapA > 0) {
        await swap(contracts.uniswapV2, tokenA, tokenB, swapA, signer, provider)
    } else if (swapB > 0) {
        await swap(contracts.uniswapV2, tokenB, tokenA, swapB, signer, provider)
    }
}

/////////////////////////////////////////////////////////////////////////
// simpified (unsafe) uniswapV2 method calls

// uniswapV2 add liquidity with wait finalize
async function addLiquidity(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    amountA: bigint,
    amountB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    await waitFinalize(provider, signer, tokenA.connect(signer).approve(uniswapV2, amountA))
    await waitFinalize(provider, signer, tokenB.connect(signer).approve(uniswapV2, amountB))
    await waitFinalize(provider, signer, uniswapV2.connect(signer).addLiquidity(
        tokenA, tokenB,
        amountA, amountB,
        0, 0, 0, 0,
        signer,
        MaxUint256
    ))
}

// blazeswap remove liquidity with wait finalize
export async function removeLiquidity(
    uniswapV2: IUniswapV2Router,
    blazeSwapPair: IUniswapV2Pair,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    const dexTokens = await blazeSwapPair.balanceOf(signer)
    if (dexTokens > BigInt(0)) {
        await waitFinalize(provider, signer, blazeSwapPair.connect(signer).approve(uniswapV2, dexTokens))
        await waitFinalize(provider, signer, uniswapV2.connect(signer).removeLiquidity(
            tokenA, tokenB,
            dexTokens,
            0, 0,
            signer,
            MaxUint256
        ))
    } else {
        console.log('remove liquidity failure: no liquidity to remove')
    }
}

export async function swap(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    amountA: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    await waitFinalize(provider, signer, tokenA.connect(signer).approve(uniswapV2, amountA))
    await waitFinalize(provider, signer, uniswapV2.connect(signer).swapExactTokensForTokens(
        amountA, 0,
        [tokenA, tokenB],
        signer,
        MaxUint256
    ))
}
