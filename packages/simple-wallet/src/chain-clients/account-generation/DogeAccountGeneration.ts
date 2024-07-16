import { ChainType } from "../../utils/constants";
import { UTXOAccountGeneration } from "./UTXOAccountGeneration";

export class DogeAccountGeneration extends UTXOAccountGeneration {
   constructor(chainType: ChainType) {
      super(chainType, chainType == ChainType.testDOGE);
   }
}
