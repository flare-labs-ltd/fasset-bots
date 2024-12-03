import { AddressValidity } from "@flarenetwork/state-connector-protocol";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { keccak256 } from "../utils/helpers";

export class MockVerificationApiClient implements IVerificationApiClient {
    async checkAddressValidity(chainId: string, addressStr: string): Promise<AddressValidity.ResponseBody> {
        const standardAddress = addressStr.trim();
        return {
            isValid: standardAddress != "" && !standardAddress.includes("INVALID"), // very fake check
            standardAddress: standardAddress,
            standardAddressHash: keccak256(standardAddress),
        }
    }
}
