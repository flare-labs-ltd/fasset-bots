import { BTC, DOGE, StuckTransaction, WalletClient, XRP } from "@flarelabs/simple-wallet";
import { ChainId } from "../underlying-chain/ChainId";
import { CommandLineError } from "../utils";
import { Secrets } from "./secrets";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import { EntityManager } from "@mikro-orm/core";

const supportedSourceIds = [ChainId.XRP, ChainId.BTC, ChainId.DOGE, ChainId.testXRP, ChainId.testBTC, ChainId.testDOGE];

export function requireSupportedChainId(chainId: ChainId) {
    if (!supportedChainId(chainId)) {
        throw new CommandLineError(`SourceId ${chainId.chainName} not supported.`);
    }
}

export function supportedChainId(chainId: ChainId) {
    return supportedSourceIds.includes(chainId);
}

/**
 * Creates wallet client.
 * @param chainId chain source
 * @param walletUrl chain's url
 * @param inTestnet if testnet should be used, optional parameter
 * @returns instance of Wallet implementation according to sourceId
 */
export async function createWalletClient(
    secrets: Secrets,
    chainId: ChainId,
    walletUrls: string[],
    em: EntityManager,
    options: StuckTransaction = {},
): Promise<WalletClient> {
    requireSupportedChainId(chainId);
    const walletKeys = DBWalletKeys.from(em, secrets);
    if (chainId === ChainId.BTC || chainId === ChainId.testBTC) {
        const apiTokenKey = secrets.optionalOrOptionalArray(`apiKey.${chainId.chainName}_rpc`) ?? secrets.optionalOrOptionalArray("apiKey.btc_rpc"); // added the last one to be backward compatible
        const apiTokenKeys = checkUrlAndApiKeyArraysMatch(apiTokenKey, walletUrls, chainId);
        return await BTC.initialize({
            urls: walletUrls,
            inTestnet: chainId === ChainId.testBTC,
            apiTokenKeys: apiTokenKeys,
            stuckTransactionOptions: options,
            em,
            walletKeys,
        }); // UtxoMccCreate
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        const apiTokenKey = secrets.optionalOrOptionalArray(`apiKey.${chainId.chainName}_rpc`) ?? secrets.optionalOrOptionalArray("apiKey.doge_rpc"); // added the last one to be backward compatible
        const apiTokenKeys = checkUrlAndApiKeyArraysMatch(apiTokenKey, walletUrls, chainId);
        return await DOGE.initialize({
            urls: walletUrls,
            inTestnet: chainId === ChainId.testDOGE,
            apiTokenKeys: apiTokenKeys,
            stuckTransactionOptions: options,
            em,
            walletKeys
        }); // UtxoMccCreate
    } else {
        const apiTokenKey = secrets.optionalOrOptionalArray(`apiKey.${chainId.chainName}_rpc`) ?? secrets.optionalOrOptionalArray("apiKey.xrp_rpc"); // added the last one to be backward compatible
        const apiTokenKeys = checkUrlAndApiKeyArraysMatch(apiTokenKey, walletUrls, chainId);
        return await XRP.initialize({
            urls: walletUrls,
            inTestnet: chainId === ChainId.testXRP,
            apiTokenKeys: apiTokenKeys,
            stuckTransactionOptions: options,
            em,
            walletKeys
        }); // XrpMccCreate
    }
}

function checkUrlAndApiKeyArraysMatch(apiTokenKey: string | string[] | undefined, walletUrls: string[], chainId: ChainId): string[] | undefined {
    if (apiTokenKey && Array.isArray(apiTokenKey) && apiTokenKey.length != walletUrls.length) {
        throw new Error(`Cannot create ${chainId.chainName} wallet. The number of URLs and API keys do not match.`);
    }
    const apiTokenKeys = Array.isArray(apiTokenKey) ? apiTokenKey : apiTokenKey ? Array(walletUrls.length).fill(apiTokenKey) : undefined;
    return apiTokenKeys;
}