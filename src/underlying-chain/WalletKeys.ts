import { EntityManager, FilterQuery } from "@mikro-orm/core";
import { WalletAddress } from "../entities/wallet";
import { decryptText, encryptText } from "../utils/encryption";
import { fail } from "../utils/helpers";

export interface IWalletKeys {
    getKey(address: string): Promise<string | undefined>;
    addKey(address: string, privateKey: string): Promise<void>;
}

export class DBWalletKeys implements IWalletKeys {
    private password = process.env['WALLET_ENCRIPTION_PASSWORD'] ?? fail("Missing wallet password");

    private privateKeyCache = new Map<string, string>();

    constructor(private em: EntityManager) { }

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
