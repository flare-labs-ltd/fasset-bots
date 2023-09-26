import Web3 from "web3";
import { provider } from "web3-core";
import { createArtifacts } from "./artifacts";
import { ContractSettings } from "./mini-truffle";
import path from "path";

const predefinedProviders: Record<string, () => any> = {
    local: () => new Web3.providers.HttpProvider("http://127.0.0.1:8545"),
};

const artifactsRootPath = path.normalize(path.resolve(__dirname, '../../artifacts'));

// following constants should be used throughout the code
export const web3: Web3 = createWeb3();

export const contractSettings: ContractSettings = {
    web3: web3,
    defaultOptions: {
        hardfork: "london",
    },
    gasMultiplier: 2,
    waitFor: { what: 'nonceIncrease', pollMS: 500, timeoutMS: 10_000 }
    // waitFor: { what: 'receipt', timeoutMS: 10_000 }
};

export const artifacts: Truffle.Artifacts = createArtifacts(artifactsRootPath, contractSettings);

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
    web3.eth.defaultAccount = typeof defaultAccount === "number" ? accounts[defaultAccount] : defaultAccount;
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
    return (global as any).web3 ?? new Web3();
}

export function usingGlobalWeb3() {
    return web3 === (global as any).web3;
}
