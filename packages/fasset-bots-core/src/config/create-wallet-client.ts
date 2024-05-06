import { StuckTransaction, WALLET } from "@flarelabs/simple-wallet";
import { ChainId } from "../underlying-chain/ChainId";
import { CommandLineError } from "../utils";
import { Secrets } from "./secrets";

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
export function createWalletClient(
    secrets: Secrets,
    chainId: ChainId,
    walletUrl: string,
    options: StuckTransaction = {}
): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    requireSupportedChainId(chainId);
    if (chainId === ChainId.BTC || chainId === ChainId.testBTC) {
        return new WALLET.BTC({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testBTC ? true : false,
            apiTokenKey: secrets.optional("apiKey.btc_rpc"),
            stuckTransactionOptions: options,
        }); // UtxoMccCreate
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testDOGE ? true : false,
            apiTokenKey: secrets.optional("apiKey.doge_rpc"),
            stuckTransactionOptions: options,
        }); // UtxoMccCreate
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: secrets.optional("apiKey.xrp_rpc"),
            inTestnet: chainId === ChainId.testXRP ? true : false,
            stuckTransactionOptions: options,
        }); // XrpMccCreate
    }
}
