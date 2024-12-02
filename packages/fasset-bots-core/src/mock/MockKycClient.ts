import { KycClient } from "../actors/plugins/KycStrategy";

export class MockKycClient implements KycClient {
    async isSanctioned(address: string, chain: string): Promise<boolean> {
        return address.includes("SANCTIONED"); // very fake check
    }
}
