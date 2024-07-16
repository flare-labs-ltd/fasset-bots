import { ChainType } from "../../utils/constants";
import { UTXOAccountGeneration } from "./UTXOAccountGeneration";

export class DogeAccountGeneration extends UTXOAccountGeneration {
   constructor(inTestnet: boolean) {
      super(inTestnet? ChainType.testDOGE : ChainType.DOGE);
   }
}
