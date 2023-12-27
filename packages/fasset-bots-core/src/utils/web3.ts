import Web3 from "web3";
import { provider } from "web3-core";
import { Artifacts } from "../../typechain-truffle";
import { createArtifacts } from "./mini-truffle-contracts/artifacts";
import { ContractSettings } from "./mini-truffle-contracts/types";
import { resolveInFassetBotsCore } from "./package-paths";

const predefinedProviders: Record<string, () => any> = {
    local: () => new Web3.providers.HttpProvider("http://127.0.0.1:8545"),
};

const artifactsRootPath = resolveInFassetBotsCore("artifacts");

// following constants should be used throughout the code
export const web3: Web3 = createWeb3();

/**
 * Default setting used by all contract instances.
 * WARNING: the settings are not copied when creating new instance.
 *   So changing this structure will change settings in every instance, except the ones creted by `withSettings(...)`.
 */
export const contractSettings: ContractSettings = updateWithHardhatNetworkDefaults({
    web3: web3,
    defaultTransactionConfig: {},
    gas: "auto",
    gasMultiplier: 1.5,
    defaultAccount: web3.eth.defaultAccount,
    waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 10_000 },
    // waitFor: { what: 'receipt', timeoutMS: 10_000 },
    nonceLockTimeoutMS: 60_000,
    resubmitTransaction: [
        { afterMS: 10_000, priceFactor: 1.2 },
        { afterMS: 20_000, priceFactor: 2.0 },
    ],
});

export const artifacts: Artifacts = createArtifacts(artifactsRootPath, contractSettings);

/**
 * Initialize web3 and truffle contracts.
 */
export async function initWeb3(provider: provider, walletKeys: string[] | "network" | null, defaultAccount: string | number | null) {
    if (usingGlobalWeb3()) {
        throw new Error("Using injected web3; initWeb3(...) has no effect.");
    }
    if (provider !== currentProvider) {
        currentProvider = provider;
        web3.setProvider(createProvider(provider));
    }
    /* istanbul ignore next */
    const accounts = walletKeys === "network" ? await web3.eth.getAccounts() : createWalletAccounts(walletKeys);
    const defaultAccountAddress = typeof defaultAccount === "number" ? accounts[defaultAccount] : defaultAccount;
    web3.eth.defaultAccount = defaultAccountAddress;
    contractSettings.defaultAccount = defaultAccountAddress;
    return accounts;
}

let currentProvider: provider;

export function authenticatedHttpProvider(url: string, apiToken?: string): provider {
    /* istanbul ignore else */
    if (!apiToken) {
        return new Web3.providers.HttpProvider(url);
    } /* istanbul ignore next */ else if (authenticatedHttpProvider.useHeader) {
        const headers = [{ name: "x-apikey", value: apiToken }];
        return new Web3.providers.HttpProvider(url, { headers });
    } else {
        /* istanbul ignore next */
        const sep = url.includes("?") ? "&" : "?";
        const authUrl = `${url}${sep}x-apikey=${apiToken}`;
        return new Web3.providers.HttpProvider(authUrl);
    }
}
// default to url, because api seems to not support header auth correctly
authenticatedHttpProvider.useHeader = false;

function createProvider(provider: provider) {
    if (typeof provider === "string") {
        if (provider in predefinedProviders) {
            return predefinedProviders[provider]();
        } else if (/^https?:\/\//.test(provider)) {
            return new Web3.providers.HttpProvider(provider);
        } else {
            throw new Error("Invalid provider url");
        }
    }
    return provider;
}

function createWalletAccounts(walletPrivateKeys: string[] | null) {
    if (walletPrivateKeys) {
        web3.eth.accounts.wallet.clear();
        for (const pk of walletPrivateKeys) {
            web3.eth.accounts.wallet.add(pk);
        }
    }
    return Array.from(web3.eth.accounts.wallet, (acc) => acc.address);
}

function createWeb3() {
    // use injected web3 if it exists
    return (global as any).web3 ?? new Web3();
}

export function usingGlobalWeb3() {
    return web3 === (global as any).web3;
}

/* istanbul ignore next */
function updateWithHardhatNetworkDefaults(settings: ContractSettings): ContractSettings {
    const networkConfig = (global as any).hre?.network?.config ?? {};
    function firstAccountAddress() {
        // use accounts[0] as default account under Hardhat
        const accounts0 = networkConfig.accounts?.[0];
        const accounts0PrivateKey = accounts0?.privateKey ?? accounts0;
        if (accounts0PrivateKey) {
            return web3.eth.accounts.privateKeyToAccount(accounts0PrivateKey).address;
        } else {
            return web3.eth.defaultAccount;
        }
    }
    return {
        web3: settings.web3,
        defaultTransactionConfig: {},
        gas: typeof settings.gas === "number" ? settings.gas : networkConfig.gas ?? "auto",
        gasMultiplier: settings.gasMultiplier, // ignore networkConfig - it has value 1 even if not set explicitly
        defaultAccount: settings.defaultAccount ?? networkConfig.from ?? firstAccountAddress(),
        waitFor: settings.waitFor,
        nonceLockTimeoutMS: settings.nonceLockTimeoutMS,
        resubmitTransaction: settings.resubmitTransaction,
    };
}
