
import { ChainType } from "../../utils/constants";
import { UTXOAccountGeneration } from "./UTXOAccountGeneration";

export class BtcAccountGeneration extends UTXOAccountGeneration {
   constructor(chainType: ChainType) {
      super(chainType, chainType == ChainType.testBTC);
   }
}
