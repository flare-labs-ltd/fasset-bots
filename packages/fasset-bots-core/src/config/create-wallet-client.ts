import { StuckTransaction, WALLET, WalletClient } from "@flarelabs/simple-wallet";
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
        return await WALLET.BTC.initialize({
            urls: walletUrls,
            inTestnet: chainId === ChainId.testBTC,
            apiTokenKeys: secrets.optionalArray("apiKey.btc_rpc"),
            stuckTransactionOptions: options,
            em,
            walletKeys
        }); // UtxoMccCreate
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        return await WALLET.DOGE.initialize({
            urls: walletUrls,
            inTestnet: chainId === ChainId.testDOGE,
            apiTokenKeys: secrets.optionalArray("apiKey.doge_rpc"),
            stuckTransactionOptions: options,
            em,
            walletKeys
        }); // UtxoMccCreate
    } else {
        return await WALLET.XRP.initialize({
            urls: walletUrls,
            inTestnet: chainId === ChainId.testXRP,
            apiTokenKeys: secrets.optionalArray("apiKey.xrp_rpc"),
            stuckTransactionOptions: options,
            em,
            walletKeys
        }); // XrpMccCreate
    }
}