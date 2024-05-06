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
        return chainIdIndex.get(chainNameOrSourceId) ?? createChainId(chainNameOrSourceId);
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

const chainIdIndex: Map<string, ChainId> = new Map();

function createChainId(chainNameOrSourceId: string) {
    const [chainName, sourceId] = chainNameOrSourceId.startsWith("0x")
        ? [decodeAttestationName(chainNameOrSourceId), chainNameOrSourceId]
        : [chainNameOrSourceId, encodeAttestationName(chainNameOrSourceId)];
    const chainId = new ChainId(chainName, sourceId);
    chainIdIndex.set(chainName, chainId);
    chainIdIndex.set(sourceId, chainId);
    return chainId;
}
