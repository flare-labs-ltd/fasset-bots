import BN from 'bn.js'

type BNish = number | string | BN
const toBN = (x: BNish) => new BN(x)

export function assertBnEqual(
  actual: BNish,
  expected: BNish,
  error: BNish = 0
) {
  const actualBN = toBN(actual)
  const expectedBN = toBN(expected)
  const errorBN = toBN(error)
  const diff = actualBN.sub(expectedBN).abs()
  if (diff.gt(errorBN)) {
    throw new Error(
      `Expected ${actualBN.toString()} to be within ${errorBN.toString()} of ${expectedBN.toString()}`
    )
  }
}