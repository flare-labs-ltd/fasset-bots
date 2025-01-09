import { TransactionEntity } from "../../src";
import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { getTransactionDescendants } from "../../src/chain-clients/utxo/UTXOUtils";

import { expect } from "chai";
import { EntityManager } from "@mikro-orm/core";
import config, { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import {
    createTransactionEntity, createTransactionEntityWithInputs,
    createTransactionInputEntity
} from "../test-util/entity_utils";

let testOrm: ORM;

describe("getTransactionDescendants", () => {
    let em: EntityManager;
    before(async () => {
        testOrm = await initializeTestMikroORM({...config, dbName: "unit-test-db"});
        em = testOrm.em;
    });

    beforeEach(async () => {
        await em.nativeDelete(TransactionInputEntity, {});
        await em.nativeDelete(TransactionEntity, {});
    });

    after(async () => {
        await testOrm.close();
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
        const tx1 = createTransactionEntityWithInputs("address1", "address2", "txHash1", [], 1);

        const tx2 = createTransactionEntityWithInputs("address1", "address3", "txHash2", [input1]);
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
        const tx1 = createTransactionEntityWithInputs("address1", "address2", "txHash1", [], 1);

        const input2 = createTransactionInputEntity("txHash2", 0);
        const tx2 = createTransactionEntityWithInputs("address1", "address3", "txHash2", [input1], 1);

        const tx3 = createTransactionEntityWithInputs("address1", "address4", "txHash3", [input2]);
        await em.persistAndFlush([tx1, tx2, tx3]);

        const descendants = await getTransactionDescendants(em, tx1.id);
        expect(descendants).to.have.length(2);
        expect(descendants).to.include.members([tx2, tx3]);
    });

    it("Should handle transactions with multiple inputs", async () => {
        /*
        tx1: output1 -> tx2 [input1] output2
                                                -> tx3 [input2, input3]
                                  _: output3
         */

        const input1 = createTransactionInputEntity("txHash1", 0);
        const tx1 = createTransactionEntityWithInputs("address1", "address2", "txHash1", [], 1);

        const input2 = createTransactionInputEntity("txHash2", 0);
        const input3 = createTransactionInputEntity("txHashOther", 0);
        const tx2 = createTransactionEntityWithInputs("address1", "address3", "txHash2", [input1], 1);

        const tx3 = createTransactionEntityWithInputs("address1", "address4", "txHash3", [input2, input3]);
        await em.persistAndFlush([tx1, tx2, tx3]);

        const descendants = await getTransactionDescendants(em, tx1.id);
        expect(descendants).to.have.length(2);
        expect(descendants).to.include.members([tx2, tx3]);
    });

});
