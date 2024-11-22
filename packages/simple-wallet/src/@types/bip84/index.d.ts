declare module 'bip84' {
    import { Network, payments } from 'bitcoinjs-lib';
    import { BIP32Interface } from 'bip32';

    export interface PubTypes {
        mainnet: { zprv: string; zpub: string };
        testnet: { vprv: string; vpub: string };
    }

    export interface Networks {
        mainnet: Network;
        testnet: Network;
    }

    export class fromMnemonic {
        constructor(
            mnemonic: string,
            password?: string,
            isTestnet?: boolean,
            coinType?: number,
            pubTypes?: PubTypes,
            network?: Network
        );

        getRootPrivateKey(): string;
        getRootPublicKey(): string;
        deriveAccount(number: number, changePurpose?: number): string;
    }

    export class fromZPrv {
        constructor(
            zprv: string,
            pubTypes?: PubTypes,
            networks?: Networks
        );

        getAccountPrivateKey(): string;
        getAccountPublicKey(): string;
        getPrivateKey(index: number, isChange?: boolean): string;
        getPublicKey(index: number, isChange?: boolean): string;
        getAddress(index: number, isChange?: boolean, purpose?: number): string;
        getKeypair(index: number, isChange?: boolean): BIP32Interface;
    }

    export class fromZPub {
        constructor(
            zpub: string,
            pubTypes?: PubTypes,
            networks?: Networks
        );

        getAccountPublicKey(): string;
        getPublicKey(index: number, isChange?: boolean): string;
        getAddress(index: number, isChange?: boolean, purpose?: number): string;
        getPayment(index: number, isChange?: boolean): payments.Payment;
    }

    export function generateMnemonic(strength?: number): string;
    export function entropyToMnemonic(entropy: Buffer): string;
    export function validateMnemonic(mnemonic: string): boolean;
}
