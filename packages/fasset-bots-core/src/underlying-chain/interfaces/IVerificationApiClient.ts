import { AddressValidity } from "@flarenetwork/state-connector-protocol";

export interface IVerificationApiClient {
    checkAddressValidity(chainId: string, addressStr: string): Promise<AddressValidity.ResponseBody>;
}
