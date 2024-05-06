import { StuckTransaction, WALLET } from "@flarelabs/simple-wallet";
import { SourceId } from "../underlying-chain/SourceId";
import { CommandLineError } from "../utils";
import { Secrets } from "./secrets";

const supportedSourceIds = [SourceId.XRP, SourceId.BTC, SourceId.DOGE, SourceId.testXRP, SourceId.testBTC, SourceId.testDOGE];

export function requireSupportedSourceId(sourceId: SourceId) {
    if (!supportedSourceId(sourceId)) {
        throw new CommandLineError(`SourceId ${sourceId.chainName} not supported.`);
    }
}

export function supportedSourceId(sourceId: SourceId) {
    return supportedSourceIds.includes(sourceId);
}

/**
 * Creates wallet client.
 * @param sourceId chain source
 * @param walletUrl chain's url
 * @param inTestnet if testnet should be used, optional parameter
 * @returns instance of Wallet implementation according to sourceId
 */
export function createWalletClient(
    secrets: Secrets,
    sourceId: SourceId,
    walletUrl: string,
    options: StuckTransaction = {}
): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    requireSupportedSourceId(sourceId);
    if (sourceId === SourceId.BTC || sourceId === SourceId.testBTC) {
        return new WALLET.BTC({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testBTC ? true : false,
            apiTokenKey: secrets.optional("apiKey.btc_rpc"),
            stuckTransactionOptions: options,
        }); // UtxoMccCreate
    } else if (sourceId === SourceId.DOGE || sourceId === SourceId.testDOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testDOGE ? true : false,
            apiTokenKey: secrets.optional("apiKey.doge_rpc"),
            stuckTransactionOptions: options,
        }); // UtxoMccCreate
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: secrets.optional("apiKey.xrp_rpc"),
            inTestnet: sourceId === SourceId.testXRP ? true : false,
            stuckTransactionOptions: options,
        }); // XrpMccCreate
    }
}
