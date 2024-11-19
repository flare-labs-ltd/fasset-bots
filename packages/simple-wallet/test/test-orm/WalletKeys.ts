import { EntityManager, FilterQuery } from "@mikro-orm/core";
import {decryptText, EncryptionMethod, encryptText, IWalletKeys, WalletAddressEntity} from "../../src";

export class DBWalletKeys implements IWalletKeys {
    private privateKeyCache = new Map<string, string>();

    constructor(
        private em: EntityManager,
        private password: string,
    ) {}

    static from(em: EntityManager, password: string) {
        return new DBWalletKeys(em, password);
    }

    async getKey(address: string): Promise<string | undefined> {
        if (!this.privateKeyCache.has(address)) {
            const wa = await this.em.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
            if (wa != null) {
                const privateKey = this.decryptPrivateKey(wa.encryptedPrivateKey);
                this.privateKeyCache.set(address, privateKey);
            }
        }
        return this.privateKeyCache.get(address);
    }

    async addKey(address: string, privateKey: string): Promise<void> {
        if (await this.getKey(address)) return;
        this.privateKeyCache.set(address, privateKey);
        const wa = new WalletAddressEntity();
        wa.address = address;
        wa.encryptedPrivateKey = this.encryptPrivateKey(privateKey);
        await this.em.persist(wa).flush();
    }

    encryptPrivateKey(privateKey: string): string {
        return encryptText(this.password, privateKey, EncryptionMethod.AES_GCM_SCRYPT_AUTH);
    }

    decryptPrivateKey(encryptedKey: string) {
        try {
            return decryptText(this.password, encryptedKey);
        } catch (error) {
            throw new Error("Error decrypting database private key - wallet encryption password is most likely incorrect");
        }
    }
}
