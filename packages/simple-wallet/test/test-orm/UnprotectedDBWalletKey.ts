import { EntityManager, FilterQuery } from "@mikro-orm/core";
import { IWalletKeys } from "../../../simple-wallet/src/interfaces/WalletTransactionInterface";
import { WalletAddressEntity } from "../../src/entity/wallet";

export class UnprotectedDBWalletKeys implements IWalletKeys {

    constructor(
        private em: EntityManager,
    ) {}

    static from(em: EntityManager) {
        return new UnprotectedDBWalletKeys(em);
    }

    async getKey(address: string): Promise<string | undefined> {
        const wa = await this.em.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
        if (wa != null) {
            return wa.encryptedPrivateKey;
        }
    }

    async addKey(address: string, privateKey: string): Promise<void> {
        if (await this.getKey(address)) return;
        // persist
        const wa = new WalletAddressEntity();
        wa.address = address;
        wa.encryptedPrivateKey = privateKey
        await this.em.persist(wa).flush();
    }
}
