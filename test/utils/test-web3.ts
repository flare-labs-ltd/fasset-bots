import hre from "hardhat";
import Web3 from "web3";
import { provider } from 'web3-core';
import { initWeb3, web3 } from "../../src/utils/web3";

const predefinedProviders: Record<string, () => any> = {
    hardhat: () => hre.network.provider,
    local: () => new Web3.providers.HttpProvider('http://127.0.0.1:8545'),
};

export const NETWORK = process.env.NETWORK ?? 'hardhat';

/**
 * Initialize web3 and truffle contracts and return accounts (for test networks).
 */
export async function initTestWeb3(provider: provider = NETWORK, defaultAccount: string | number | null = 0) {
    const accounts = await initWeb3(createProvider(provider), 'network', defaultAccount);
    configureOpenzeppelin();
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

function configureOpenzeppelin() {
    require('@openzeppelin/test-helpers/configure')({
        provider: web3.currentProvider,
        singletons: {
            abstraction: 'truffle',
            defaultSender: web3.eth.defaultAccount,
        },
    });
}
