import Web3 from "web3";
import { provider } from 'web3-core';
import { artifacts } from "./artifacts";

const predefinedProviders: Record<string, () => any> = {
    local: () => new Web3.providers.HttpProvider('http://127.0.0.1:8545'),
};

// should be used throughout the code
export const web3: Web3 = createWeb3();

let currentProvider: provider;

/**
 * Initialize web3 and truffle contracts.
 */
export async function initWeb3(provider: provider, walletKeys: string[] | 'network' | null, defaultAccount: string | number | null) {
    if (usingGlobalWeb3()) {
        console.warn("Using injected web3; initWeb3(...) has no effect.")
    }
    if (provider !== currentProvider) {
        currentProvider = provider;
        web3.setProvider(createProvider(provider));
    }
    const accounts = walletKeys === 'network' ? await web3.eth.getAccounts() : createWalletAccounts(walletKeys);
    web3.eth.defaultAccount = typeof defaultAccount === 'number' ? accounts[defaultAccount] : defaultAccount;
    artifacts.updateWeb3?.(web3);
    return accounts;
}

function createProvider(provider: provider) {
    if (typeof provider === 'string') {
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
    return Array.from(web3.eth.accounts.wallet, acc => acc.address);
}

function createWeb3() {
    return (global as any).web3 ?? new Web3();
}

export function usingGlobalWeb3() {
    return web3 === (global as any).web3;
}
