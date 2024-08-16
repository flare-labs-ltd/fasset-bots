
import { ChainType } from "../../utils/constants";
import { UTXOAccountGeneration } from "./UTXOAccountGeneration";

export class BtcAccountGeneration extends UTXOAccountGeneration {
   constructor(inTestnet: boolean) {
      super(inTestnet? ChainType.testBTC : ChainType.BTC);
   }
}
