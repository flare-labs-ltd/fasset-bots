declare module 'dogecoin-bip84' {
    import { BIP84 } from 'bip84';

    export class fromMnemonic extends BIP84 {
        constructor(mnemonic: string, password?: string, isTestnet?: boolean);

        getRootPrivateKey(): string;
        getRootPublicKey(): string;
        deriveAccount(number: number, changePurpose?: number): string;
    }

    export class fromZPrv extends BIP84 {
        constructor(zprv: string);

        getAccountPrivateKey(): string;
        getAccountPublicKey(): string;
        getPrivateKey(index: number, isChange?: boolean): string;
        getPublicKey(index: number, isChange?: boolean): string;
        getAddress(index: number, isChange?: boolean, purpose?: number): string;
    }

    export class fromZPub extends BIP84 {
        constructor(zpub: string);

        getAccountPublicKey(): string;
        getPublicKey(index: number, isChange?: boolean): string;
        getAddress(index: number, isChange?: boolean, purpose?: number): string;
    }

    export function generateMnemonic(strength?: number): string;
    export function entropyToMnemonic(entropy: Buffer): string;
}
