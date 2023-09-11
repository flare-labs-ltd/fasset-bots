import BN from 'bn.js'

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
export const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

export type BNish = number | string | BN
export const toBN = (x: BNish) => new BN(x)
export const minBN = (a: BN, b: BN) => a.lt(b) ? a : b