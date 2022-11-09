import { provider } from 'web3-core';
import { initWeb3, usingGlobalWeb3, web3 } from "../../src/utils/web3";

export const NETWORK = process.env.NETWORK ?? 'local';

/**
 * Initialize web3 and truffle contracts and return accounts (for test networks).
 */
export async function initTestWeb3(provider?: provider, defaultAccount: string | number | null = 0) {
    // special case when it is safe to use hardhat network
    if (usingGlobalWeb3() && provider == undefined) {
        return await web3.eth.getAccounts();
    }
    const accounts = await initWeb3(provider ?? NETWORK, 'network', defaultAccount);
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
