import { formatUnits } from "ethers"

export function logAddedLiquidityForSlippage(
    addedA: bigint, addedB: bigint,
    slippageBips: number, amountA: bigint,
    symbolA: string, symbolB: string,
    decimalsA: bigint, decimalsB: bigint,
): void {
    const amountA_f = formatUnits(amountA, decimalsA)
    const slippage_f = formatUnits(slippageBips, 4)
    const addedA_f = formatUnits(addedA, decimalsA)
    const addedB_f = formatUnits(addedB, decimalsB)
    const log = `adding ${addedA_f} ${symbolA} and ${addedB_f} ${symbolB} to pool to produce ${slippage_f} slippage`
        + ` at ${amountA_f} ${symbolA} trade volume`
    console.log(log)
}

export function logSlippageUnnecessary(
    slippageBips: number, amountA: bigint,
    maxAddedA: bigint, maxAddedB: bigint,
    symbolA: string, symbolB: string,
    decimalsA: bigint, decimalsB: bigint,
): void {
    const amountA_f = formatUnits(amountA, decimalsA)
    const slippage_f = formatUnits(slippageBips, 4)
    const maxAddedA_f = formatUnits(maxAddedA, decimalsA)
    const maxAddedB_f = formatUnits(maxAddedB, decimalsB)
    const log = `pool (${symbolA}, ${symbolB}) already has the required slippage ${slippage_f} at trade volume ${amountA_f} ${symbolA}`
        + ` (note that the reserves may have been capped to ${maxAddedA_f} ${symbolA} and ${maxAddedB_f} ${symbolB})`
    console.log(log)
}

export function logUnableToProduceSlippage(
    addedA: bigint, addedB: bigint,
    slippageBips: number, amountA: bigint,
    symbolA: string, symbolB: string,
    decimalsA: bigint, decimalsB: bigint,
): void {
    const amountA_f = formatUnits(amountA, decimalsA)
    const slippage_f = formatUnits(slippageBips, 4)
    const addedA_f = formatUnits(addedA, decimalsA)
    const addedB_f = formatUnits(addedB, decimalsB)
    const log = `unable to add ${addedA_f} ${symbolA} and ${addedB_f} ${symbolB} to pool to produce slippage ${slippage_f}`
        + `at trade volume ${amountA_f} ${symbolA}`
    console.error(log)
}

export function logRemovingLiquidityBeforeRetrying(
    symbolA: string, symbolB: string
): void {
    const log = `removing liquidity from pool (${symbolA}, ${symbolB}) before retrying`
    console.error(log)
}

export function logCappingDesiredSwapAmount(
    swap: bigint, maxSwap: bigint,
    symbol: string, decimals: bigint
): void {
    const swap_f = formatUnits(swap, decimals)
    const maxSwap_f = formatUnits(maxSwap, decimals)
    const log = `capping desired swap of ${swap_f} ${symbol} to ${maxSwap_f}`
    console.log(log)
}

export function logSwapping(
    swap: bigint, symbolA: string,
    symbolB: string, decimals: bigint
): void {
    const swap_f = formatUnits(swap, decimals)
    const log = `swapping ${swap_f} ${symbolA} for ${symbolB}`
    console.log(log)
}

export function logRemovedLiquidity(
    removedA: bigint, removedB: bigint,
    symbolA: string, symbolB: string,
    decimalsA: bigint, decimalsB: bigint
): void {
    const removedA_f = formatUnits(removedA, decimalsA)
    const removedB_f = formatUnits(removedB, decimalsB)
    const log = `removed ${removedA_f} ${symbolA} and ${removedB_f} ${symbolB} from pool`
    console.log(log)
}
