import { EntityManager, FilterQuery } from "@mikro-orm/core";
import { decryptText, encryptText } from "../utils/encryption";
import { Secrets } from "../config";
import { IWalletKeys } from "../../../simple-wallet/src/interfaces/WalletTransactionInterface";
import { WalletAddressEntity } from "../../../simple-wallet/src/entity/wallet";

export class MemoryWalletKeys implements IWalletKeys {
    private keys = new Map<string, string>();

    async getKey(address: string): Promise<string | undefined> {
        return this.keys.get(address);
    }

    async addKey(address: string, privateKey: string): Promise<void> {
        this.keys.set(address, privateKey);
    }
}

export class DBWalletKeys implements IWalletKeys {
    private privateKeyCache = new Map<string, string>();

    constructor(
        private em: EntityManager,
        private password: string,
    ) {}

    static from(em: EntityManager, secrets: Secrets) {
        return new DBWalletKeys(em, this.encryptionPassword(secrets));
    }

    static encryptionPassword(secrets: Secrets) {
        return secrets.requiredEncryptionPassword("wallet.encryption_password");
    }

    async getKey(address: string): Promise<string | undefined> {
        if (!this.privateKeyCache.has(address)) {
            const wa = await this.em.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
            if (wa != null) {
                const privateKey = decryptText(this.password, wa.encryptedPrivateKey);
                this.privateKeyCache.set(address, privateKey);
            }
        }
        return this.privateKeyCache.get(address);
    }

    async addKey(address: string, privateKey: string): Promise<void> {
        if (await this.getKey(address)) return;
        // set cache
        this.privateKeyCache.set(address, privateKey);
        // persist
        const wa = new WalletAddressEntity();
        wa.address = address;
        wa.encryptedPrivateKey = encryptText(this.password, privateKey, true);
        await this.em.persist(wa).flush();
    }
}
