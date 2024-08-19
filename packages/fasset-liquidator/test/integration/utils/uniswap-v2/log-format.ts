import { formatUnits } from "ethers"


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

export function logPoolAlreadySynced(
    symbolA: string, symbolB: string, priceError?: bigint
): void {
    const add = (priceError !== undefined) ? ` with price error ${priceError} bips` : ""
    console.log(`pool (${symbolA}, ${symbolB}) is already in sync with ftso prices${add}`)
}

export function logPoolOutOfSync(
    symbolA: string, symbolB: string, priceError: bigint
): void {
    console.log(`pool (${symbolA}, ${symbolB}) is out of sync with ftso prices by ${priceError} bips`)
}