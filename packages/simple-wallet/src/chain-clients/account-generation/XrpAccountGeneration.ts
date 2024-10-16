import { Wallet as xrplWallet } from "xrpl"; // package has some member access issues

import { generateMnemonic } from "bip39";
import { ICreateWalletResponse, WalletAccountGenerationInterface } from "../../interfaces/IWalletTransaction";
import { ChainType, MNEMONIC_STRENGTH } from "../../utils/constants";

export class XrpAccountGeneration implements WalletAccountGenerationInterface {
    chainType: ChainType;

    constructor(inTestnet: boolean) {
        this.chainType = inTestnet ? ChainType.testXRP : ChainType.XRP;
    }

    /**
     * @returns {Object} - wallet with auto generated mnemonic
     */
    createWallet(): ICreateWalletResponse {
        const mnemonic = generateMnemonic(MNEMONIC_STRENGTH);
        const resp = xrplWallet.fromMnemonic(mnemonic);
        return {
            privateKey: resp.privateKey,
            publicKey: resp.publicKey,
            address: resp.classicAddress,
            mnemonic: mnemonic,
        } as ICreateWalletResponse;
    }

    /**
     * @param {string} mnemonic - mnemonic used for wallet creation
     * @returns {Object} - wallet generated using mnemonic from input
     */
    createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse {
        const resp = xrplWallet.fromMnemonic(mnemonic);
        return {
            privateKey: resp.privateKey,
            publicKey: resp.publicKey,
            address: resp.classicAddress,
            mnemonic: mnemonic,
        } as ICreateWalletResponse;
    }

    /**
     * @param {string} seed - seed used for wallet creation
     * @param {string|undefined} algorithm
     * @returns {Object} - wallet
     */
    createWalletFromSeed(seed: string, algorithm?: ECDSA): ICreateWalletResponse {
        const wallet = xrplWallet.fromSeed(seed, { algorithm: algorithm });
        return {
            address: wallet.address,
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            mnemonic: "",
        };
    }

    /**
     * @param {string} entropy - entropy used for wallet creation
     * @param {string|undefined} algorithm
     * @returns {Object} - wallet
     */
    createWalletFromEntropy(entropy: Uint8Array, algorithm?: ECDSA): ICreateWalletResponse {
        const wallet = xrplWallet.fromEntropy(entropy, { algorithm: algorithm });
        return {
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            address: wallet.address,
            mnemonic: "",
        };
    }
}

export enum ECDSA {
    ed25519 = "ed25519",
    secp256k1 = "ecdsa-secp256k1"
}