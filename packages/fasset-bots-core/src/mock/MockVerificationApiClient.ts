import { AddressValidity } from "@flarenetwork/state-connector-protocol";
import Web3 from "web3";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";

export class MockVerificationApiClient implements IVerificationApiClient {
    async checkAddressValidity(chainId: string, addressStr: string): Promise<AddressValidity.ResponseBody> {
        const standardAddress = addressStr.trim();
        return {
            isValid: standardAddress != "" && !standardAddress.includes("INVALID"), // very fake check
            standardAddress: standardAddress,
            standardAddressHash: Web3.utils.soliditySha3Raw(standardAddress),
        }
    }
}
