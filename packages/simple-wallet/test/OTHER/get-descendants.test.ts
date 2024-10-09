import { SpentHeightEnum, TransactionEntity, UTXOEntity } from "../../src";

import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { toBN } from "web3-utils";
import { getTransactionDescendants } from "../../src/chain-clients/utxo/UTXOUtils";

import { expect } from "chai";
import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import config, { initializeTestMikroORMWithConfig } from "../test-orm/mikro-orm.config";
import { createTransactionEntity } from "../test-util/entity_utils";

describe("getTransactionDescendants", () => {
    let em: EntityManager;
    before(async () => {
        const conf = { ...config };
        conf.dbName = "getTransactionDescendants-test-db";
        em = (await initializeTestMikroORMWithConfig(conf)).em;
    });

    beforeEach(async () => {
        await em.nativeDelete(UTXOEntity, {});
        await em.nativeDelete(TransactionInputEntity, {});
        await em.nativeDelete(TransactionEntity, {});
    });

    it("should return an empty array when there are no descendants", async () => {
        const tx = createTransactionEntity("address1", "address2", "txHash1");
        await em.persistAndFlush(tx);

        const descendants = await getTransactionDescendants(em, tx.transactionHash!, tx.source);
        expect(descendants).to.be.an("array").that.is.empty;
    });

    it("Chain with one descendant", async () => {
        /*
        tx1: utxo1 -> tx2
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const utxo1 = await createUTXOEntity("address1", "txHash1", 0);

        const tx2 = createTransactionEntity("address1", "address3", "txHash2", [utxo1]);
        await em.persistAndFlush([tx1, tx2]);

        const descendants = await getTransactionDescendants(em, tx1.transactionHash!, tx1.source);
        expect(descendants).to.have.length(1);
        expect(descendants).to.include(tx2);
    });

    it("Chain with two descendants", async () => {
        /*
        tx1: utxo1 -> tx2: utxo2 -> tx3
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const utxo1 = await createUTXOEntity("address1", "txHash1", 0);

        const tx2 = createTransactionEntity("address1", "address3", "txHash2", [utxo1]);
        const utxo2 = await createUTXOEntity("address1", "txHash2", 0);

        const tx3 = createTransactionEntity("address1", "address4", "txHash3", [utxo2]);
        await em.persistAndFlush([tx1, tx2, tx3]);

        const descendants = await getTransactionDescendants(em, tx1.transactionHash!, tx1.source);
        expect(descendants).to.have.length(2);
        expect(descendants).to.include.members([tx2, tx3]);
    });

    it("should handle transactions with multiple inputs", async () => {
        /*
        tx1: utxo1 -> tx2: utxo2
                                   -> tx3
                        _: utxo3
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const utxo1 = await createUTXOEntity("address1", "txHash1", 0);

        const tx2 = createTransactionEntity("address1", "address3", "txHash2", [utxo1]);
        const utxo2 = await createUTXOEntity("address1", "txHash2", 0);
        const utxo3 = await createUTXOEntity("address1", "txHashOther", 0);

        const tx3 = createTransactionEntity("address1", "address4", "txHash3", [utxo2, utxo3]);
        await em.persistAndFlush([tx1, tx2, tx3]);

        const descendants = await getTransactionDescendants(em, tx1.transactionHash!, tx1.source);
        expect(descendants).to.have.length(2);
        expect(descendants).to.include.members([tx2, tx3]);
    });

    async function createUTXOEntity(
        source: string,
        mintTransactionHash: string,
        position: number,
    ) {
        const utxoEntity = em.create(UTXOEntity, {
            source: source,
            mintTransactionHash: mintTransactionHash,
            position: position,
            value: toBN(0),
            spentHeight: SpentHeightEnum.SPENT,
            script: "",
        } as RequiredEntityData<UTXOEntity>);
        await em.persistAndFlush(utxoEntity);
        return utxoEntity;
    }
});
