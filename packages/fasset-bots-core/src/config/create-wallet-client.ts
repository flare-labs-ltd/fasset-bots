import { FeeServiceConfig, StuckTransaction, WALLET, WalletClient } from "@flarelabs/simple-wallet";
import { ChainId } from "../underlying-chain/ChainId";
import { CommandLineError } from "../utils";
import { Secrets } from "./secrets";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import { EntityManager } from "@mikro-orm/core";
import { WalletApiType, WalletApi, FeeServiceOptions } from "../underlying-chain/interfaces/IBlockChainWallet";

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
    walletUrl: string,
    em: EntityManager,
    walletApiType: WalletApiType | null,
    options: StuckTransaction = {},
    feeServiceOptions?: FeeServiceOptions,
    fallbackApis?: WalletApi[],
): Promise<WalletClient> {
    requireSupportedChainId(chainId);
    const walletKeys = DBWalletKeys.from(em, secrets);

    const fallbacks = fallbackApis?.map((api: WalletApi, i: number) => ({
        apiTokenKey: secrets.optional(`apiKey.${getWalletSymbol(chainId)}_rpc_${i + 1}`),
        type: api.type,
        url: api.url,
    }));

    if (chainId === ChainId.BTC || chainId === ChainId.testBTC) {
        if (!walletApiType) {
            throw new CommandLineError(`WalletApiType is missing for ${chainId.chainName}.`);
        }
        return await WALLET.BTC.initialize({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testBTC,
            apiTokenKey: secrets.optional("apiKey.btc_rpc"),
            stuckTransactionOptions: options,
            em,
            walletKeys,
            api: walletApiType,
            feeServiceConfig: walletApiType === "blockbook" ? {
                indexerUrl: walletUrl,
                rateLimitOptions: feeServiceOptions?.rateLimitOptions,
                numberOfBlocksInHistory: feeServiceOptions?.numberOfBlocksInHistory,
                sleepTimeMs: feeServiceOptions?.sleepTimeMs,
            } as FeeServiceConfig : undefined,
            fallbackAPIs: fallbacks,
        }); // UtxoMccCreate
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        if (!walletApiType) {
            throw new CommandLineError(`WalletApiType is missing for ${chainId.chainName}.`);
        }
        return await WALLET.DOGE.initialize({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testDOGE,
            apiTokenKey: secrets.optional("apiKey.doge_rpc"),
            stuckTransactionOptions: options,
            em,
            walletKeys,
            api: walletApiType,
            feeServiceConfig: walletApiType === "blockbook" ? {
                indexerUrl: walletUrl,
                rateLimitOptions: feeServiceOptions?.rateLimitOptions,
                numberOfBlocksInHistory: feeServiceOptions?.numberOfBlocksInHistory,
                sleepTimeMs: feeServiceOptions?.sleepTimeMs,
            } as FeeServiceConfig : undefined,
            fallbackAPIs: fallbacks,
        }); // UtxoMccCreate
    } else {
        return await WALLET.XRP.initialize({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: secrets.optional("apiKey.xrp_rpc"),
            inTestnet: chainId === ChainId.testXRP,
            stuckTransactionOptions: options,
            em,
            walletKeys,
            fallbackAPIs: fallbacks,
        }); // XrpMccCreate
    }
}

function getWalletSymbol(chainId: ChainId) {
    switch (chainId) {
        case ChainId.BTC:
            return "BTC";
        case ChainId.testBTC:
            return "testBTC";
        case ChainId.DOGE:
            return "DOGE";
        case ChainId.testDOGE:
            return "testDOGE";
        case ChainId.testXRP:
            return "testXRP";
        case ChainId.XRP:
            return "XRP";
    }
}