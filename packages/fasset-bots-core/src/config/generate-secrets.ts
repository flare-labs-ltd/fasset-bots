import crypto from "node:crypto";
import Web3 from "web3";
import { ChainId } from "../underlying-chain/ChainId";
import { CommandLineError, requireNotNull } from "../utils";
import { loadConfigFile } from "./config-file-loader";
import { ChainAccount, SecretsFile } from "./config-files/SecretsFile";
import { ICreateWalletResponse } from "../../../simple-wallet/src/interfaces/WalletTransactionInterface";
import { XrpAccountGeneration } from "../../../simple-wallet/src/chain-clients/account-generation/XrpAccountGeneration";
import { BtcAccountGeneration } from "../../../simple-wallet/src/chain-clients/account-generation/BtcAccountGeneration";
import { DogeAccountGeneration } from "../../../simple-wallet/src/chain-clients/account-generation/DogeAccountGeneration";
import { WalletAccount } from "../../../simple-wallet/src/types";

export type SecretsUser = "user" | "agent" | "other";

export function generateSecrets(configFile: string, users: SecretsUser[], agentManagementAddress?: string) {
    const web3 = new Web3();
    function generateAccount(chainNames: Set<string>) {
        const result: { [key: string]: ChainAccount } = {};
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

export function generateUnderlyingAccount(chainName: string): ICreateWalletResponse {
    const chainId = ChainId.from(chainName);
    const walletClient = createStubWalletClient(chainId);
    return walletClient.createWallet();
}

function createStubWalletClient(chainId: ChainId): WalletAccount {
    if (chainId === ChainId.BTC || chainId === ChainId.testBTC) {
        const inTestnet: boolean = ChainId.testBTC ? true : false;
        return new BtcAccountGeneration(inTestnet);
    } else if (chainId === ChainId.DOGE || chainId === ChainId.testDOGE) {
        const inTestnet: boolean = ChainId.testDOGE ? true : false;
        return new DogeAccountGeneration(inTestnet);
    } else if (chainId === ChainId.XRP || chainId === ChainId.testXRP) {
        const inTestnet: boolean = ChainId.testXRP ? true : false;
        return new XrpAccountGeneration(inTestnet);
    } else {
        throw new CommandLineError(`Chain name ${chainId} not supported.`);
    }
}
