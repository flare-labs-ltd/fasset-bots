import Web3 from "web3";
import { provider } from 'web3-core';
import { artifacts } from "./artifacts";

// should be used throughout the code
export const web3 = new Web3();

let currentProvider: provider;

/**
 * Initialize web3 and truffle contracts.
 */
export async function initWeb3(provider: provider, walletKeys: string[] | 'network' | null, defaultAccount: string | number | null) {
    if (provider !== currentProvider) {
        currentProvider = provider;
        web3.setProvider(provider);
    }
    const accounts = walletKeys === 'network' ? await web3.eth.getAccounts() : createWalletAccounts(walletKeys);
    web3.eth.defaultAccount = typeof defaultAccount === 'number' ? accounts[defaultAccount] : defaultAccount;
    artifacts.updateWeb3(web3);
    return accounts;
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
