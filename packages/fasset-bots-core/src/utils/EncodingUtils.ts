import { ABICache, AbiData, AbiDataInput } from "./ABICache";

export class EncodingUtils {
  private readonly abiCache = new ABICache();

  private static _instance: EncodingUtils | undefined = undefined;
  public static get instance(): EncodingUtils {
    if (!this._instance) {
      this._instance = new EncodingUtils();
    }
    return this._instance;
  }

  /**
   * Returns ABI definition for a given smart contract name and function name
   * @param contractName
   * @param functionName
   * @returns
   */
  getFunctionAbiData(contractName: string, functionName: string): AbiData {
    return this.abiCache.getAbi(contractName, functionName);
  }

  /**
   * Returns ABI definition for a given smart contract name and event name
   * @param contractName
   * @param eventName
   * @returns
   */
  getEventAbiData(contractName: string, eventName: string): AbiData {
    return this.abiCache.getAbi(contractName, undefined, eventName);
  }

  /**
   * Returns ABI input definition for a given smart contract name, function name and function argument id
   * @param contractName
   * @param functionName
   * @param functionArgumentId
   * @returns
   */
  getFunctionInputAbiData(contractName: string, functionName: string, functionArgumentId: any): AbiDataInput {
    return this.abiCache.getAbiInput(contractName, functionName, functionArgumentId);
  }

  /**
   * Returns function signature for a given smart contract name and function name
   * @param smartContractName
   * @param functionName
   * @returns
   */
  getFunctionSignature(smartContractName: string, functionName: string): string {
    return this.getFunctionAbiData(smartContractName, functionName).signature;
  }

  /**
   * Returns event signature for a given smart contract name and event name
   * @param smartContractName
   * @param eventName
   * @returns
   */
  getEventSignature(smartContractName: string, eventName: string): string {
    return this.getEventAbiData(smartContractName, eventName).signature;
  }
}

export function unPrefix0x(str: string) {
  return str.startsWith("0x") ? str.slice(2) : str;
}
