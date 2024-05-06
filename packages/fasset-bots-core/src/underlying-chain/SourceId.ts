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

    static fromChainName(chainName: string): ChainId {
        return chainIdIndex.get(chainName) ?? createChainId(chainName, encodeAttestationName(chainName));
    }

    static fromSourceId(sourceId: string): ChainId {
        return chainIdIndex.get(sourceId) ?? createChainId(decodeAttestationName(sourceId), sourceId);
    }

    static XRP = ChainId.fromChainName("XRP");
    static testXRP = ChainId.fromChainName("testXRP");
    static BTC = ChainId.fromChainName("BTC");
    static testBTC = ChainId.fromChainName("testBTC");
    static DOGE = ChainId.fromChainName("DOGE");
    static testDOGE = ChainId.fromChainName("testDOGE");
    static LTC = ChainId.fromChainName("LTC");
    static testLTC = ChainId.fromChainName("testLTC");
    static ALGO = ChainId.fromChainName("ALGO");
    static testALGO = ChainId.fromChainName("testALGO");
}

const chainIdIndex: Map<string, ChainId> = new Map();

function createChainId(chainName: string, attestationSourceId: string) {
    const chainId = new ChainId(chainName, attestationSourceId);
    chainIdIndex.set(chainName, chainId);
    chainIdIndex.set(attestationSourceId, chainId);
    return chainId;
}
