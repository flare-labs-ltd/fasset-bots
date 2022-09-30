import Web3 from "web3";
import { provider } from 'web3-core';
import { artifacts } from "./artifacts";

const predefinedProviders: Record<string, () => provider> = {
    local: () => new Web3.providers.HttpProvider('http://127.0.0.1:8545'),
};

// should be used throughout the code
export const web3 = new Web3();

let currentProvider: provider;

/**
 * Initialize web3 and truffle contracts and return accounts.
 */
export async function initWeb3(provider: provider, defaultAccount: string | number | null = 0) {
    if (provider !== currentProvider) {
        currentProvider = provider;
        if (typeof provider === 'string') {
            provider = predefinedProviders[provider]();
        }
        web3.setProvider(provider);
    }
    const accounts = await web3.eth.getAccounts();
    web3.eth.defaultAccount = typeof defaultAccount === 'number' ? accounts[defaultAccount] : defaultAccount;
    artifacts.updateWeb3(web3);
    return accounts;
}
