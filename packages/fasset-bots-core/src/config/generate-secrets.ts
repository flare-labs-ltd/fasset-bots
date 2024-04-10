import { WALLET } from "@flarelabs/simple-wallet";
import { encodeAttestationName } from "@flarenetwork/state-connector-protocol";
import crypto from "node:crypto";
import Web3 from "web3";
import { SourceId } from "../underlying-chain/SourceId";
import { ChainAccount } from "./config-files/SecretsFile";
import { SecretsFile } from "./config-files/SecretsFile";
import { loadConfigFile } from "./config-file-loader";
import { requireNotNull } from "../utils";

export type SecretsUser = "user" | "agent" | "other";

export function generateSecrets(configFile: string, users: SecretsUser[], agentManagementAddress?: string) {
    const web3 = new Web3();
    function generateAccount(chainIds: Set<string>) {
        const result: { [key: string]: ChainAccount } = {};
        result.native = generateNativeAccount();
        for (const chainId of chainIds) {
            const sourceId = encodeAttestationName(chainId);
            const walletClient = createStubWalletClient(sourceId);
            const underlyingAccount = walletClient.createWallet();
            result[chainId] = {
                address: underlyingAccount.address,
                private_key: underlyingAccount.privateKey,
            };
        }
        return result;
    }
    function generateNativeAccount(): ChainAccount {
        const account = web3.eth.accounts.create();
        return {
            address: account.address,
            private_key: account.privateKey,
        };
    }
    const config = loadConfigFile(configFile);
    const chainIds = new Set(Object.values(config.fAssets).map(fi => fi.chainId));
    const secrets: SecretsFile = { apiKey: {} };
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
        secrets.owner = generateAccount(chainIds);
        secrets.owner.management = { address: requireNotNull(agentManagementAddress) } as any;
    }
    if (users.includes("user")) {
        secrets.user = generateAccount(chainIds);
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
