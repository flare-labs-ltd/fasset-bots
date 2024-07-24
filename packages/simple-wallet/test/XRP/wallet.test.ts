import {WALLET} from "../../src";
import {
    ICreateWalletResponse,
    RippleWalletConfig,
    TransactionInfo
} from "../../src/interfaces/WalletTransactionInterface";
import chaiAsPromised from "chai-as-promised";
import {expect, use} from "chai";
import WAValidator from "wallet-address-validator";
import rewire from "rewire";
import {XRP_DECIMAL_PLACES} from "../../src/utils/constants";
import {toBN, toBNExp} from "../../src/utils/bnutils";
import {fetchTransactionEntityById, updateTransactionEntity} from "../../src/db/dbutils";
import {TransactionEntity, TransactionStatus} from "../../src/entity/transaction";
import {
    checkStatus,
    clearTransactions,
    createAndSignXRPTransactionWithStatus,
    loop, setWalletStatusInDB, TEST_WALLET_XRP
} from "../test_util/util";

use(chaiAsPromised);

const rewiredXrpWalletImplementation = rewire("../../src/chain-clients/XrpWalletImplementation");
const rewiredXrpWalletImplementationClass = rewiredXrpWalletImplementation.__get__("XrpWalletImplementation");
const walletSecret = "secret_address"

const XRPMccConnectionTest: RippleWalletConfig = {
   url: process.env.XRP_URL ?? "",
   username: "",
   password: "",
   stuckTransactionOptions: {
      blockOffset: 10,
   },
   rateLimitOptions: {
      timeoutMs: 60000,
   },
   walletSecret: walletSecret,
   inTestnet: true
};

const fundedSeed = "sannPkA1sGXzM1MzEZBjrE1TDj4Fr";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const entropyBase = "my_xrp_test_wallet";
const entropyBasedAddress = "rMeXpc8eokNRCTVtCMjFqTKdyRezkYJAi1";

const amountToSendDropsFirst = toBNExp(0.1, XRP_DECIMAL_PLACES);
const amountToSendDropsSecond = toBNExp(0.05, XRP_DECIMAL_PLACES);
const feeInDrops = toBNExp(0.000015, 6);
const maxFeeInDrops = toBNExp(0.000012, 6);
const sequence = 54321;

let wClient: WALLET.XRP;
let fundedWallet: ICreateWalletResponse; //testnet, seed: sannPkA1sGXzM1MzEZBjrE1TDj4Fr, account: rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8

describe("Xrp wallet tests", () => {
    before(async () => {
        wClient = await WALLET.XRP.initialize(XRPMccConnectionTest);
        void wClient.startMonitoringTransactionProgress();
    });

    after(async () => {
        wClient.stopMonitoring();
        await clearTransactions(wClient.orm);
    });

   it("Should create account", async () => {
      const newAccount = wClient.createWallet();
      expect(newAccount.address).to.not.be.null;
      const targetAccount = wClient.createWalletFromMnemonic(targetMnemonic);
      expect(targetAccount.address).to.equal(targetAddress);

      expect(WAValidator.validate(newAccount.address, "XRP", "testnet")).to.be.true;
      expect(WAValidator.validate(targetAccount.address, "XRP", "testnet")).to.be.true;
   });

   it("Should create account 2", async () => {
      const newAccount = wClient.createWalletFromEntropy(Buffer.from(entropyBase), "ecdsa-secp256k1");
      expect(newAccount.address).to.equal(entropyBasedAddress);
      expect(WAValidator.validate(newAccount.address, "XRP", "testnet")).to.be.true;
   });

   it("Should create account 3", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      expect(fundedWallet.address).to.equal(fundedAddress);
      expect(WAValidator.validate(fundedWallet.address, "XRP", "testnet")).to.be.true;
   });

   it("Should get public key from private key", async () => {
      const seed0 = "sh8N3CZNMqdjBhgsbdzp8NoEnr8MH";
      const seed1 = "sEdTcEtUFE7BxDKj5QfdgyGorRKmq73";
      const wallet0 = wClient.createWalletFromSeed(seed0, "ecdsa-secp256k1");
      const wallet1 = wClient.createWalletFromSeed(seed1, "ed25519");

      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      const public0 = rewired.getPublicKeyFromPrivateKey(wallet0.privateKey, wallet0.address);
      const public1 = rewired.getPublicKeyFromPrivateKey(wallet1.privateKey, wallet1.address);
      expect(wallet0.publicKey).to.eq(public0);
      expect(wallet1.publicKey).to.eq(public1);
   });

   it("Should submit transaction", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, undefined, note, undefined);
      expect(id).to.be.gt(0);
      let tx = null;

      await loop(2000, 20000, tx, async () => {
          wClient.orm.em.clear();
          tx = await fetchTransactionEntityById(wClient.orm, id);
          return checkStatus(tx, [TransactionStatus.TX_SUCCESS]);
      })
   });

   it("Should not validate submit and resubmit transaction - fee to low", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const lowFee = toBN(0);
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, lowFee, note);
      expect(id).to.be.gt(0);
      let replacedTx: TransactionInfo | TransactionEntity | null = null;
      let txInfo = null;

       await loop(2000, 20000, txInfo, async () => {
           wClient.orm.em.clear();
           txInfo = await wClient.getTransactionInfo(id);
           if (txInfo.replacedByDdId)
               replacedTx = await fetchTransactionEntityById(wClient.orm, txInfo.replacedByDdId);
           if (replacedTx)
               return checkStatus(replacedTx, [TransactionStatus.TX_FAILED]);
       })

      const tx = await fetchTransactionEntityById(wClient.orm, id);
      expect(tx.status).to.equal(TransactionStatus.TX_REPLACED);
   });

   it("Should create transaction with fee", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "Submit";
      const trId = await wClient.createPaymentTransaction(
         fundedWallet.address,
         fundedWallet.privateKey,
         targetAddress,
         amountToSendDropsSecond,
         feeInDrops,
         note,
         undefined,
      );
      let txEnt = await fetchTransactionEntityById(wClient.orm, trId);
      expect(txEnt.source).to.equal(fundedWallet.address);
      expect(txEnt.destination).to.equal(targetAddress);
      expect(txEnt.fee?.toString()).to.equal(feeInDrops.toString());
      expect(txEnt.reference).to.equal(note);

       await loop(2000, 40000, txEnt, async () => {
           wClient.orm.em.clear();
           txEnt = await fetchTransactionEntityById(wClient.orm, trId);
           return checkStatus(txEnt, [TransactionStatus.TX_SUCCESS]);
       });
   });

    it("Should not submit transaction: fee > maxFee", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsSecond, feeInDrops, "Submit", maxFeeInDrops);
        expect(id).to.be.gt(0);

        let tx = await fetchTransactionEntityById(wClient.orm, id);
        await loop(2000, 30000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, id);
            return checkStatus(tx, [TransactionStatus.TX_FAILED]);
        });

        tx = await fetchTransactionEntityById(wClient.orm, id);
        expect(tx.maxFee!.lt(tx.fee!)).to.be.true;
    });

   it("Should receive fee", async () => {
      const feeP = await wClient.getCurrentTransactionFee({ isPayment: true });
      expect(feeP).not.to.be.null;
      const fee = await wClient.getCurrentTransactionFee({ isPayment: false });
      expect(fee).not.to.be.null;
      expect(fee.gt(feeP)).to.be.true;
   });

   it("Should receive latest validated ledger index", async () => {
      const index = await wClient.getLatestValidatedLedgerIndex();
      expect(index).not.to.be.null;
   });

    it("Should not submit resubmitted transaction - fee to low", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const lowFee = toBN(2);
        const maxFee = toBN(3);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, lowFee, note, maxFee);
        expect(id).to.be.gt(0);

        let tx = await fetchTransactionEntityById(wClient.orm, id);
        await loop(2000, 40000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, id);
            return checkStatus(tx, [TransactionStatus.TX_FAILED]);
        })

        const txInfo = await wClient.getTransactionInfo(id);
        expect(txInfo.replacedByDdId).to.be.null;
        const txEnt = await fetchTransactionEntityById(wClient.orm, id);
        expect(txEnt.maxFee!.lt(txEnt.fee!.muln(wClient.feeIncrease))).to.be.true;
    });

   // Running this takes cca 20 min, as account can only be deleted
   // if account sequence + DELETE_ACCOUNT_OFFSET < ledger number
    it.skip("Should create and delete account", async () => {
        const toDelete = wClient.createWallet();
        expect(toDelete.address).to.not.be.null;
        expect(WAValidator.validate(toDelete.address, "XRP", "testnet")).to.be.true;
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        expect(WAValidator.validate(fundedWallet.address, "XRP", "testnet")).to.be.true;
        const toSendInDrops = toBNExp(20, 6); // 20 XPR
        // fund toDelete account
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, toDelete.address, toSendInDrops);

        let tx = await fetchTransactionEntityById(wClient.orm, id);
        await loop(2000, 30000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, id);
            return checkStatus(tx, [TransactionStatus.TX_SUCCESS]);
        });

        const balance = await wClient.getAccountBalance(toDelete.address);
        // delete toDelete account
        const id2 = await wClient.createDeleteAccountTransaction(toDelete.address, toDelete.privateKey, fundedWallet.address);

        await loop(2000, 25 * 60000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, id2);
            return checkStatus(tx, [TransactionStatus.TX_FAILED]);
        })

        const balance2 = await wClient.getAccountBalance(toDelete.address);
        expect(balance.gt(balance2));
    });

    it("Should receive account balance", async () => {
        const newAccount = wClient.createWallet();
        const bn = await wClient.getAccountBalance(newAccount.address);
        expect(bn).to.not.be.null;
        expect(bn.toNumber()).to.be.equal(0);

        const bn2 = await wClient.getAccountBalance("x");
        expect(bn2).to.not.be.null;
        expect(bn2.toNumber()).to.be.equal(0);
    })

    it("Should successfully resubmit transaction with fee < minFee", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const lowFee = toBN("5"); // toBN("10") is minFee for XRP
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, lowFee, note);
        expect(id).to.be.gt(0);
        let replacedTx: TransactionEntity | TransactionInfo | null = null;

        let txInfo = null;

        await loop(2000, 40000, txInfo, async () => {
            txInfo = await wClient.getTransactionInfo(id);
            if (txInfo.replacedByDdId)
                replacedTx = await fetchTransactionEntityById(wClient.orm, txInfo.replacedByDdId);
            if (replacedTx)
                return checkStatus(replacedTx, [TransactionStatus.TX_SUCCESS]);
            wClient.orm.em.clear();
        });

        const tx = await fetchTransactionEntityById(wClient.orm, id);
        expect(tx.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should handle TX_PENDING", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_PENDING);

        const allowedEndStatuses = [TransactionStatus.TX_SUCCESS]
        const notAllowedEndStatuses = [TransactionStatus.TX_FAILED, TransactionStatus.TX_SUBMISSION_FAILED, TransactionStatus.TX_REPLACED];

        let txInfo = await wClient.getTransactionInfo(txEnt.id);
        let replacedTx: TransactionEntity | TransactionInfo | null = null;

        expect(txInfo.status).to.equal(TransactionStatus.TX_PENDING);

        await loop(2000, 40000, txInfo, async () => {
            txInfo = await wClient.getTransactionInfo(txEnt.id);
            if (txInfo.replacedByDdId)
                replacedTx = await fetchTransactionEntityById(wClient.orm, txInfo.replacedByDdId);
            if (replacedTx)
                return checkStatus(replacedTx, allowedEndStatuses, notAllowedEndStatuses);
            wClient.orm.em.clear();
        });

        expect(txInfo!.replacedByDdId)
        expect(txInfo!.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should not resubmit TX_PENDING - already on chain", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, feeInDrops, note);

        await loop(2000, 40000, null, async () => {
            wClient.orm.em.clear();
            return checkStatus(await fetchTransactionEntityById(wClient.orm, id), [TransactionStatus.TX_SUCCESS]);
        });

        expect((await wClient.getTransactionInfo(id)).status).to.equal(TransactionStatus.TX_SUCCESS);
        await updateTransactionEntity(wClient.orm, id, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_PENDING;
        });
        expect((await wClient.getTransactionInfo(id)).status).to.equal(TransactionStatus.TX_PENDING);

        let txInfo = await wClient.getTransactionInfo(id);
        await loop(500, 40000, txInfo, async () => {
            wClient.orm.em.clear();
            txInfo = await wClient.getTransactionInfo(id);
            return checkStatus(txInfo, [TransactionStatus.TX_SUCCESS]);
        });

        txInfo = await wClient.getTransactionInfo(id);
        expect(txInfo.status).to.equal(TransactionStatus.TX_SUCCESS);
        expect(!txInfo.replacedByDdId).true;
    });

    it("Should handle TX_FAILED_SUBMISSION", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_SUBMISSION_FAILED);

        let txInfo = await wClient.getTransactionInfo(txEnt.id);
        let replacedTx: TransactionEntity | TransactionInfo | null = null;

        expect(txInfo.status).to.equal(TransactionStatus.TX_SUBMISSION_FAILED);

        await loop(2000, 40000, txInfo, async () => {
            wClient.orm.em.clear();
            txInfo = await wClient.getTransactionInfo(txEnt.id);
            if (txInfo.replacedByDdId)
                replacedTx = await fetchTransactionEntityById(wClient.orm, txInfo.replacedByDdId);
            if (replacedTx)
                return checkStatus(replacedTx, [TransactionStatus.TX_SUCCESS]);
        });

        expect(txInfo.replacedByDdId)
        expect(txInfo.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_PREPARED);

        let tx = await fetchTransactionEntityById(wClient.orm, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_PREPARED);

        await loop(2000, 40000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, txEnt.id);
            return checkStatus(tx, [TransactionStatus.TX_SUCCESS]);
        });
    });

    it("Transaction with executeUntilBlock before current ledger index should fail", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const currentBlock = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(
            fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, feeInDrops,
            note, maxFeeInDrops, currentBlock - 5);

        let tx = await fetchTransactionEntityById(wClient.orm, id);
        await loop(2000, 40000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, id);
            return checkStatus(tx, [TransactionStatus.TX_FAILED]);
        });
    });

    it("Transaction with executeUntilBlock too low should fail", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const currentBlock = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(
            fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, maxFeeInDrops,
            note, maxFeeInDrops, currentBlock + 1);

        let tx = await fetchTransactionEntityById(wClient.orm, id);
        await loop(2000, 40000, tx, async () => {
            wClient.orm.em.clear();
            tx = await fetchTransactionEntityById(wClient.orm, id);
            return checkStatus(tx, [TransactionStatus.TX_FAILED]);
        });
    });


    it("Account that is deleting should not enable creating transaction", async () => {
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        await setWalletStatusInDB(wClient.orm, TEST_WALLET_XRP.address, true);

        await expect(
            wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, feeInDrops, note, maxFeeInDrops)
        ).to.eventually.be.rejectedWith(`Cannot receive requests. ${fundedWallet.address} is deleting`);

        await setWalletStatusInDB(wClient.orm, TEST_WALLET_XRP.address, false);
    });

    it("Account balance should change after transaction", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, feeInDrops, note);

        const allowedEndStatuses = [TransactionStatus.TX_SUCCESS]
        const notAllowedEndStatuses = [TransactionStatus.TX_FAILED,  TransactionStatus.TX_SUBMISSION_FAILED, TransactionStatus.TX_REPLACED];

        const balanceStart = await wClient.getAccountBalance(fundedWallet.address);
        expect(balanceStart.toNumber()).to.be.gt(0);

        await loop(2000, 40000,  null,async () => {
            wClient.orm.em.clear();
            const tx = await fetchTransactionEntityById(wClient.orm, id);
            return checkStatus(tx, allowedEndStatuses, notAllowedEndStatuses);
        })

        const balanceEnd = await wClient.getAccountBalance(fundedWallet.address);
        expect(balanceStart.sub(balanceEnd).sub(feeInDrops).toNumber()).to.be.equal(amountToSendDropsFirst.toNumber());

    });
});
