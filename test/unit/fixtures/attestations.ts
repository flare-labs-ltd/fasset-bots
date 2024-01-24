import { encodeBytes32String } from 'ethers'
import type { BalanceDecreasingTransaction } from '../../../types/contracts/Challenger'


export const balanceDecreasingTxProof: BalanceDecreasingTransaction.ProofStruct = {
  merkleProof: [encodeBytes32String("")],
  data: {
    attestationType: encodeBytes32String(""),
    sourceId: encodeBytes32String(""),
    votingRound: BigInt(0),
    lowestUsedTimestamp: BigInt(0),
    requestBody: {
      transactionId: encodeBytes32String(""),
      sourceAddressIndicator: encodeBytes32String("")
    },
    responseBody:  {
      blockNumber: BigInt(0),
      blockTimestamp: BigInt(0),
      sourceAddressHash: encodeBytes32String(""),
      spentAmount: BigInt(0),
      standardPaymentReference: encodeBytes32String("")
    },
  }
}