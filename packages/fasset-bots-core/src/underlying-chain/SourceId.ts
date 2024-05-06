import { decodeAttestationName, encodeAttestationName } from "@flarenetwork/state-connector-protocol";

export class SourceId {
    constructor(
        /**
         * Human readable chain name (e.g. "XRP", "testXRP").
         */
        readonly chainName: string,

        /**
         * Attestation provider source id, a 32 byte hex encoded string with "0x" prefix.
         * Equals `encodeAttestationName(chainName)`.
         */
        readonly sourceId: string,
    ) {}

    toString() {
        return this.chainName;
    }

    static fromChainName(chainName: string): SourceId {
        return sourceIdIndex.get(chainName) ?? createSourceId(chainName, encodeAttestationName(chainName));
    }

    static fromSourceId(sourceId: string): SourceId {
        return sourceIdIndex.get(sourceId) ?? createSourceId(decodeAttestationName(sourceId), sourceId);
    }

    static XRP = SourceId.fromChainName("XRP");
    static testXRP = SourceId.fromChainName("testXRP");
    static BTC = SourceId.fromChainName("BTC");
    static testBTC = SourceId.fromChainName("testBTC");
    static DOGE = SourceId.fromChainName("DOGE");
    static testDOGE = SourceId.fromChainName("testDOGE");
    static LTC = SourceId.fromChainName("LTC");
    static testLTC = SourceId.fromChainName("testLTC");
    static ALGO = SourceId.fromChainName("ALGO");
    static testALGO = SourceId.fromChainName("testALGO");
}

const sourceIdIndex: Map<string, SourceId> = new Map();

function createSourceId(chainName: string, attestationSourceId: string) {
    const sourceId = new SourceId(chainName, attestationSourceId);
    sourceIdIndex.set(chainName, sourceId);
    sourceIdIndex.set(attestationSourceId, sourceId);
    return sourceId;
}
