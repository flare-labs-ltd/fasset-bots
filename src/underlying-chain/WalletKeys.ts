import { WalletAddress } from "../actors/entities";
import { PersistenceContext } from "../PersistenceContext";
import { decryptText, encryptText } from "../utils/encryption";
import { fail } from "../utils/helpers";

export interface IWalletKeys {
    getKey(address: string): Promise<string | undefined>;
    addKey(address: string, privateKey: string): Promise<void>;
}

export abstract class DBWalletKeys implements IWalletKeys {
    private password = process.env['WALLET_ENCRIPTION_PASSWORD'] ?? fail("Missing wallet password");
    
    private privateKeyCache = new Map<string, string>();
    
    constructor (private pc: PersistenceContext) {}
    
    async getKey(address: string): Promise<string | undefined> {
        if (!this.privateKeyCache.has(address)) {
            const wa = await this.pc.em.findOne(WalletAddress, { address });
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
        await this.pc.em.persist(wa).flush();
    }
}
