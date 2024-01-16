import { WALLET } from "@flarelabs/simple-wallet";
import crypto from "node:crypto";
import Web3 from "web3";
import { SourceId } from "../underlying-chain/SourceId";
import { NativeAccount, Secrets, UnifiedAccount } from "./secrets";

export type SecretsUser = "user" | "agent" | "other";

export function generateSecrets(users: SecretsUser[], sourceId: SourceId) {
    const web3 = new Web3();
    // will only generate underlying accounts for the first fasset chain (enough for beta, where only one chain is supported)
    const walletClient = createStubWalletClient(sourceId);
    function generateAccount(): UnifiedAccount {
        const account = web3.eth.accounts.create();
        const underlyingAccount = walletClient.createWallet();
        return {
            native_address: account.address,
            native_private_key: account.privateKey,
            underlying_address: underlyingAccount.address,
            underlying_private_key: underlyingAccount.privateKey,
        };
    }
    function generateNativeAccount(): NativeAccount {
        const account = web3.eth.accounts.create();
        return {
            native_address: account.address,
            native_private_key: account.privateKey,
        };
    }
    const secrets: Secrets = { apiKey: {} };
    secrets.apiKey.native_rpc = "";
    if (users.includes("agent") || users.includes("user")) {
        secrets.apiKey.xrp_rpc = "";
        secrets.apiKey.indexer = "";
    }
    if (users.includes("agent")) {
        secrets.apiKey.agent_bot = crypto.randomBytes(32).toString("hex");
        secrets.wallet = {
            encryption_password: crypto.randomBytes(15).toString("base64"),
        };
        secrets.owner = generateAccount();
    }
    if (users.includes("user")) {
        secrets.user = generateAccount();
    }
    if (users.includes("other")) {
        secrets.challenger = generateNativeAccount();
        secrets.liquidator = generateNativeAccount();
        secrets.systemKeeper = generateNativeAccount();
        secrets.timeKeeper = generateNativeAccount();
    }
    return secrets;
}

function createStubWalletClient(sourceId: SourceId) {
    if (sourceId === SourceId.BTC || sourceId === SourceId.testBTC) {
        return new WALLET.BTC({
            url: "",
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testBTC ? true : false,
        }); // UtxoMccCreate
    } else if (sourceId === SourceId.DOGE || sourceId === SourceId.testDOGE) {
        return new WALLET.DOGE({
            url: "",
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testDOGE ? true : false,
        }); // UtxoMccCreate
    } else if (sourceId === SourceId.XRP || sourceId === SourceId.testXRP) {
        return new WALLET.XRP({
            url: "",
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testXRP ? true : false,
        }); // XrpMccCreate
    } else {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
}
