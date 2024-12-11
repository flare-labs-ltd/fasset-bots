import crypto from "node:crypto";
import Web3 from "web3";
import { ChainId } from "../underlying-chain/ChainId";
import { CommandLineError, requireNotNull } from "../utils";
import { loadConfigFile } from "./config-file-loader";
import { ChainAccount, SecretsFile } from "./config-files/SecretsFile";
import { BtcAccountGeneration, DogeAccountGeneration, ICreateWalletResponse, WalletAccount, XrpAccountGeneration } from "@flarelabs/simple-wallet";

export type SecretsUser = "user" | "agent" | "other";

export function generateSecrets(configFile: string, users: SecretsUser[], agentManagementAddress?: string) {
    const web3 = new Web3();
    function generateAccount(chainNames: Set<string>, initData: any) {
        const result: { [key: string]: ChainAccount } = { ...initData };
        result.native = generateNativeAccount();
        for (const chainName of chainNames) {
            const underlyingAccount = generateUnderlyingAccount(chainName);
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
    secrets.apiKey.data_access_layer = "";
    if (users.includes("agent") || users.includes("user")) {
        // api keys
        for (const chainId of chainIds) {
            secrets.apiKey[`${chainId}_rpc`] = [""];
        }
        secrets.apiKey.indexer = [""];
        // database - needed for wallet
        secrets.database = {
            user: "",
            password: ""
        }
        // wallet
        secrets.wallet = {
            encryption_password: crypto.randomBytes(15).toString("base64"),
        };
    }
    if (users.includes("agent")) {
        secrets.apiKey.agent_bot = crypto.randomBytes(32).toString("hex");
        secrets.owner = generateAccount(chainIds, {
            management: { address: requireNotNull(agentManagementAddress) }
        });
    }
    if (users.includes("user")) {
        secrets.user = generateAccount(chainIds, {});
    }
    if (users.includes("agent")) {
        secrets.requestSubmitter = generateNativeAccount();
        secrets.timeKeeper = generateNativeAccount();
    }
    if (users.includes("other")) {
        secrets.timeKeeper = generateNativeAccount();
        secrets.challenger = generateNativeAccount();
        secrets.liquidator = generateNativeAccount();
        secrets.systemKeeper = generateNativeAccount();
        secrets.pricePublisher = generateNativeAccount();
    }
    return secrets;
}

export function generateUnderlyingAccount(chainName: string): ICreateWalletResponse {
    const chainId = ChainId.from(chainName);
    const walletClient = createStubWalletClient(chainId);
    return walletClient.createWallet();
}

function createStubWalletClient(chainId: ChainId): WalletAccount {
    if (chainId === ChainId.BTC || chainId === ChainId.testBTC) {
        const inTestnet: boolean = chainId === ChainId.testBTC ? true : false;
        return new BtcAccountGeneration(inTestnet);
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        const inTestnet: boolean = chainId === ChainId.testDOGE ? true : false;
        return new DogeAccountGeneration(inTestnet);
    } else if (chainId === ChainId.XRP || chainId === ChainId.testXRP) {
        const inTestnet: boolean = chainId === ChainId.testXRP ? true : false;
        return new XrpAccountGeneration(inTestnet);
    } else {
        throw new CommandLineError(`Chain name ${chainId} not supported.`);
    }
}
