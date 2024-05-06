import { WALLET } from "@flarelabs/simple-wallet";
import crypto from "node:crypto";
import Web3 from "web3";
import { ChainId } from "../underlying-chain/SourceId";
import { requireNotNull } from "../utils";
import { loadConfigFile } from "./config-file-loader";
import { ChainAccount, SecretsFile } from "./config-files/SecretsFile";

export type SecretsUser = "user" | "agent" | "other";

export function generateSecrets(configFile: string, users: SecretsUser[], agentManagementAddress?: string) {
    const web3 = new Web3();
    function generateAccount(chainNames: Set<string>) {
        const result: { [key: string]: ChainAccount } = {};
        result.native = generateNativeAccount();
        for (const chainName of chainNames) {
            const chainId = ChainId.from(chainName);
            const walletClient = createStubWalletClient(chainId);
            const underlyingAccount = walletClient.createWallet();
            result[chainName] = {
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

function createStubWalletClient(chainId: ChainId) {
    if (chainId === ChainId.BTC || chainId === ChainId.testBTC) {
        return new WALLET.BTC({
            url: "",
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testBTC ? true : false,
        }); // UtxoMccCreate
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        return new WALLET.DOGE({
            url: "",
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testDOGE ? true : false,
        }); // UtxoMccCreate
    } else if (chainId === ChainId.XRP || chainId === ChainId.testXRP) {
        return new WALLET.XRP({
            url: "",
            username: "",
            password: "",
            inTestnet: chainId === ChainId.testXRP ? true : false,
        }); // XrpMccCreate
    } else {
        throw new Error(`SourceId ${chainId} not supported.`);
    }
}
