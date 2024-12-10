import { HandshakeAddressVerifier } from "../actors/plugins/HandshakeAddressVerifier";

export class MockHandshakeAddressVerifier implements HandshakeAddressVerifier {
    async isSanctioned(address: string, chain: string): Promise<boolean> {
        return address.includes("SANCTIONED"); // very fake check
    }
}
