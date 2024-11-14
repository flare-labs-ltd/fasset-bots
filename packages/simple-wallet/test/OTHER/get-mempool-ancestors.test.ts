import config, { initializeTestMikroORMWithConfig } from "../test-orm/mikro-orm.config";
import { ChainType } from "../../src/utils/constants";
import { EntityManager } from "@mikro-orm/core";
import { TransactionUTXOService } from "../../src/chain-clients/utxo/TransactionUTXOService";
import { createTransactionEntity } from "../test-util/entity_utils";
import { TransactionEntity, TransactionStatus, UTXOEntity } from "../../src";
import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { expect } from "chai";
import { MockBlockchainAPI } from "../test-util/common_utils";
import { IUtxoWalletServices } from "../../src/chain-clients/utxo/IUtxoWalletServices";


describe("getNumberOfMempoolAncestors", () => {
    let em: EntityManager;
    const chainType = ChainType.testBTC;
    const services: IUtxoWalletServices = {} as IUtxoWalletServices;

    async function checkNumberOfAncestors(txHash: string, expectedNumberOfMempoolAncestors: number) {
        const txService = services.transactionUTXOService;
        expect(await txService.getNumberOfMempoolAncestors(txHash)).to.be.eq(expectedNumberOfMempoolAncestors);
    }

    before(async () => {
        const conf = { ...config };
        conf.dbName = "get-transaction-descendants-test-db";
        em = (await initializeTestMikroORMWithConfig(conf)).em;
        services.rootEm = em;
        services.blockchainAPI = new MockBlockchainAPI();
        services.transactionUTXOService = new TransactionUTXOService(services, chainType, 2);
    });

    beforeEach(async () => {
        await em.nativeDelete(UTXOEntity, {});
        await em.nativeDelete(TransactionInputEntity, {});
        await em.nativeDelete(TransactionEntity, {});
    });

    it("Transaction with one direct ancestor", async () => {
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const tx2 = createTransactionEntity("address1", "address3", "txHash2", [], [tx1], TransactionStatus.TX_CREATED);

        await em.persistAndFlush([tx1, tx2]);

        await checkNumberOfAncestors(tx1.transactionHash!, 0);
        await checkNumberOfAncestors(tx2.transactionHash!, 0);
    });

    it("Transaction with two direct ancestors with status TX_SUCCESS", async () => {
        /*
        tx1 (SUCCESS)
                        -> tx3 (CREATED)
        tx2 (SUCCESS)
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const tx2 = createTransactionEntity("address1", "address3", "txHash2");
        const tx3 = createTransactionEntity("address1", "address3", "txHash3", [], [tx1, tx2], TransactionStatus.TX_CREATED);

        await em.persistAndFlush([tx1, tx2, tx3]);

        await checkNumberOfAncestors(tx1.transactionHash!, 0);
        await checkNumberOfAncestors(tx2.transactionHash!, 0);
        await checkNumberOfAncestors(tx3.transactionHash!, 0);
    });

    it("Transaction with mixed chain of ancestors", async () => {
        /*
        tx1 (SUCCESS)
                        -> tx3 (CREATED) -> tx4 (CREATED)
        tx2 (SUCCESS)
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const tx2 = createTransactionEntity("address1", "address3", "txHash2");
        const tx3 = createTransactionEntity("address1", "address3", "txHash3", [], [tx1, tx2], TransactionStatus.TX_CREATED);
        const tx4 = createTransactionEntity("address1", "address3", "txHash4", [], [tx3], TransactionStatus.TX_CREATED);

        await em.persistAndFlush([tx1, tx2, tx3, tx4]);

        await checkNumberOfAncestors(tx1.transactionHash!, 0);
        await checkNumberOfAncestors(tx2.transactionHash!, 0);
        await checkNumberOfAncestors(tx3.transactionHash!, 0);
        await checkNumberOfAncestors(tx4.transactionHash!, 1);
    });

    it("Transaction with chain of ancestors", async () => {
        /*
        tx1 (SUCCESS) -> tx2 (CREATED) -> tx3 (CREATED) -> tx4 (CREATED)
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const tx2 = createTransactionEntity("address1", "address3", "txHash2", [], [tx1], TransactionStatus.TX_CREATED);
        const tx3 = createTransactionEntity("address1", "address3", "txHash3", [], [tx2], TransactionStatus.TX_CREATED);
        const tx4 = createTransactionEntity("address1", "address3", "txHash4", [], [tx3], TransactionStatus.TX_CREATED);

        await em.persistAndFlush([tx1, tx2, tx3, tx4]);

        await checkNumberOfAncestors(tx1.transactionHash!, 0);
        await checkNumberOfAncestors(tx2.transactionHash!, 0);
        await checkNumberOfAncestors(tx3.transactionHash!, 1);
        await checkNumberOfAncestors(tx4.transactionHash!, 2);
    });

    it("Transaction with chain of ancestors 2", async () => {
        /*
        tx1 (SUCCESS) -> tx2 (CREATED) -> tx3 (CREATED) -> tx4 (CREATED) -> tx5 (CREATED)
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const tx2 = createTransactionEntity("address1", "address3", "txHash2", [], [tx1], TransactionStatus.TX_CREATED);
        const tx3 = createTransactionEntity("address1", "address3", "txHash3", [], [tx2], TransactionStatus.TX_CREATED);
        const tx4 = createTransactionEntity("address1", "address3", "txHash4", [], [tx3], TransactionStatus.TX_CREATED);
        const tx5 = createTransactionEntity("address1", "address3", "txHash5", [], [tx4], TransactionStatus.TX_CREATED);

        await em.persistAndFlush([tx1, tx2, tx3, tx4, tx5]);

        await checkNumberOfAncestors(tx1.transactionHash!, 0);
        await checkNumberOfAncestors(tx2.transactionHash!, 0);
        await checkNumberOfAncestors(tx3.transactionHash!, 1);
        await checkNumberOfAncestors(tx4.transactionHash!, 2);
        await checkNumberOfAncestors(tx5.transactionHash!, 3);
    });

    it("Transaction with chain of ancestors 3", async () => {
        /*
        tx1 (SUCCESS)
                      -> tx5 (CREATED) -> tx7 (CREATED)
        tx2 (SUCCESS)
                                                        -> tx9 (CREATED)
        tx3 (SUCCESS) -> tx6 (CREATED)
                                       -> tx8 (CREATED)
                         tx4 (SUCCESS)
         */
        const tx1 = createTransactionEntity("address1", "address2", "txHash1");
        const tx2 = createTransactionEntity("address1", "address3", "txHash2");
        const tx3 = createTransactionEntity("address1", "address3", "txHash3");
        const tx4 = createTransactionEntity("address1", "address3", "txHash4");

        const tx5 = createTransactionEntity("address1", "address3", "txHash5", [], [tx1, tx2], TransactionStatus.TX_CREATED);
        const tx6 = createTransactionEntity("address1", "address3", "txHash6", [], [tx3], TransactionStatus.TX_CREATED);
        const tx7 = createTransactionEntity("address1", "address3", "txHash7", [], [tx5], TransactionStatus.TX_CREATED);
        const tx8 = createTransactionEntity("address1", "address4", "txHash8", [], [tx4, tx6], TransactionStatus.TX_CREATED);

        const tx9 = createTransactionEntity("address1", "address4", "txHash9", [], [tx7, tx8], TransactionStatus.TX_CREATED);

        await em.persistAndFlush([tx1, tx2, tx3, tx4, tx5, tx6, tx7, tx8, tx9]);

        await checkNumberOfAncestors(tx1.transactionHash!,0);
        await checkNumberOfAncestors(tx2.transactionHash!,0);
        await checkNumberOfAncestors(tx3.transactionHash!,0);
        await checkNumberOfAncestors(tx4.transactionHash!,0);

        await checkNumberOfAncestors(tx5.transactionHash!,0);
        await checkNumberOfAncestors(tx6.transactionHash!,0);
        await checkNumberOfAncestors(tx7.transactionHash!,1);
        await checkNumberOfAncestors(tx8.transactionHash!,1);

        await checkNumberOfAncestors(tx9.transactionHash!,4);

    });
});
