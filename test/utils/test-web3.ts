import hre from "hardhat";
import { provider } from 'web3-core';
import { initWeb3, usingGlobalWeb3, web3 } from "../../src/utils/web3";

export const NETWORK = process.env.NETWORK ?? 'hardhat';

/**
 * Initialize web3 and truffle contracts and return accounts (for test networks).
 */
export async function initTestWeb3(provider: provider = NETWORK, defaultAccount: string | number | null = 0) {
    if (provider === 'hardhat') {
        provider = hre.network.provider as any;
    }
    const accounts = await initWeb3(provider, 'network', defaultAccount);
    configureOpenzeppelin();
    return accounts;
}

function configureOpenzeppelin() {
    if (usingGlobalWeb3()) return;
    require('@openzeppelin/test-helpers/configure')({
        provider: web3.currentProvider,
        singletons: {
            abstraction: 'truffle',
            defaultSender: web3.eth.defaultAccount,
        },
    });
}
