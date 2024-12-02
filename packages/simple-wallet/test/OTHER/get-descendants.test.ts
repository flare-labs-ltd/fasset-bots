import { TransactionEntity } from "../../src";

import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { getTransactionDescendants } from "../../src/chain-clients/utxo/UTXOUtils";

import { expect } from "chai";
import { EntityManager } from "@mikro-orm/core";
import config, { initializeTestMikroORMWithConfig } from "../test-orm/mikro-orm.config";
import {
    createTransactionEntity, createTransactionEntityWithInputsAndOutputs,
    createTransactionInputEntity, createTransactionOutputEntity
} from "../test-util/entity_utils";
import {TransactionOutputEntity} from "../../src/entity/transactionOutput";

describe("getTransactionDescendants", () => {
    let em: EntityManager;
    before(async () => {
        const conf = { ...config };
        conf.dbName = "unit-test-db";
        em = (await initializeTestMikroORMWithConfig(conf)).em;
    });

    beforeEach(async () => {
        await em.nativeDelete(TransactionInputEntity, {});
        await em.nativeDelete(TransactionOutputEntity, {});
        await em.nativeDelete(TransactionEntity, {});
    });

    it("should return an empty array when there are no descendants", async () => {
        const tx = createTransactionEntity("address1", "address2", "txHash1");
        await em.persistAndFlush(tx);

        const descendants = await getTransactionDescendants(em, tx.id);
        expect(descendants).to.be.an("array").that.is.empty;
    });

    it("Chain with one descendant", async () => {
        /*
        tx1: output1 -> tx2 [input]
         */
        const input1 = createTransactionInputEntity("txHash1", 0);
        const output1 = createTransactionOutputEntity("txHash1", 0);
        const tx1 = createTransactionEntityWithInputsAndOutputs("address1", "address2", "txHash1", [], [output1]);

        const tx2 = createTransactionEntityWithInputsAndOutputs("address1", "address3", "txHash2", [input1]);
        await em.persistAndFlush([tx1, tx2, input1]);

        const descendants = await getTransactionDescendants(em, tx1.id);
        expect(descendants).to.have.length(1);
        expect(descendants).to.include(tx2);
    });

    it("Chain with two descendants", async () => {
        /*
        tx1: output1 -> tx2 [input1] output2 -> tx3 [input2]
         */
        const input1 = createTransactionInputEntity("txHash1", 0);
        const output1 = createTransactionOutputEntity("txHash1", 0);
        const tx1 = createTransactionEntityWithInputsAndOutputs("address1", "address2", "txHash1", [], [output1]);

        const input2 = createTransactionInputEntity("txHash2", 0);
        const output2 = createTransactionOutputEntity("txHash2", 0);
        const tx2 = createTransactionEntityWithInputsAndOutputs("address1", "address3", "txHash2", [input1], [output2]);

        const tx3 = createTransactionEntityWithInputsAndOutputs("address1", "address4", "txHash3", [input2]);
        await em.persistAndFlush([tx1, tx2, tx3]);

        const descendants = await getTransactionDescendants(em, tx1.id);
        expect(descendants).to.have.length(2);
        expect(descendants).to.include.members([tx2, tx3]);
    });

    it("should handle transactions with multiple inputs", async () => {
        /*
        tx1: output1 -> tx2 [input1] output2
                                                -> tx3 [input2, input3]
                                  _: output3
         */

        const input1 = createTransactionInputEntity("txHash1", 0);
        const output1 = createTransactionOutputEntity("txHash1", 0);
        const tx1 = createTransactionEntityWithInputsAndOutputs("address1", "address2", "txHash1", [], [output1]);

        const input2 = createTransactionInputEntity("txHash2", 0);
        const output2 = createTransactionOutputEntity("txHash2", 0);
        const input3 = createTransactionInputEntity("txHashOther", 0);
        const tx2 = createTransactionEntityWithInputsAndOutputs("address1", "address3", "txHash2", [input1], [output2]);

        const tx3 = createTransactionEntityWithInputsAndOutputs("address1", "address4", "txHash3", [input2, input3]);
        await em.persistAndFlush([tx1, tx2, tx3]);

        const descendants = await getTransactionDescendants(em, tx1.id);
        expect(descendants).to.have.length(2);
        expect(descendants).to.include.members([tx2, tx3]);
    });

});
