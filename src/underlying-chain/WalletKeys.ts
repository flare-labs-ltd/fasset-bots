import { EntityManager, FilterQuery } from "@mikro-orm/core";
import { WalletAddress } from "../entities/wallet";
import { decryptText, encryptText } from "../utils/encryption";
import { requireSecret } from "../config/secrets";

export interface IWalletKeys {
    getKey(address: string): Promise<string | undefined>;
    addKey(address: string, privateKey: string): Promise<void>;
}

export class DBWalletKeys implements IWalletKeys {
    private password = requireSecret("wallet_encryption_password");

    private privateKeyCache = new Map<string, string>();

    constructor(private em: EntityManager) {}

    async getKey(address: string): Promise<string | undefined> {
        if (!this.privateKeyCache.has(address)) {
            const wa = await this.em.findOne(WalletAddress, { address } as FilterQuery<WalletAddress>);
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
        const wa = new WalletAddress();
        wa.address = address;
        wa.encryptedPrivateKey = encryptText(this.password, privateKey);
        await this.em.persist(wa).flush();
    }
}
