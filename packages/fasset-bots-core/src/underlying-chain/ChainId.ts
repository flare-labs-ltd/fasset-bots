import { decodeAttestationName, encodeAttestationName } from "@flarenetwork/state-connector-protocol";

export class ChainId {
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

    static from(chainNameOrSourceId: string): ChainId {
        return ChainId.chainIdIndex.get(chainNameOrSourceId) ?? ChainId.createChainId(chainNameOrSourceId);
    }

    private static chainIdIndex: Map<string, ChainId> = new Map();

    private static createChainId(chainNameOrSourceId: string) {
        const [chainName, sourceId] = chainNameOrSourceId.startsWith("0x")
            ? [decodeAttestationName(chainNameOrSourceId), chainNameOrSourceId]
            : [chainNameOrSourceId, encodeAttestationName(chainNameOrSourceId)];
        const chainId = new ChainId(chainName, sourceId);
        ChainId.chainIdIndex.set(chainName, chainId);
        ChainId.chainIdIndex.set(sourceId, chainId);
        return chainId;
    }

    static XRP = ChainId.from("XRP");
    static testXRP = ChainId.from("testXRP");
    static BTC = ChainId.from("BTC");
    static testBTC = ChainId.from("testBTC");
    static DOGE = ChainId.from("DOGE");
    static testDOGE = ChainId.from("testDOGE");
    static LTC = ChainId.from("LTC");
    static testLTC = ChainId.from("testLTC");
    static ALGO = ChainId.from("ALGO");
    static testALGO = ChainId.from("testALGO");
}
