import { PersistenceContext } from "../../../src/config/PersistenceContext";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";

let rootPc: PersistenceContext;
let pc: PersistenceContext;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;

let walletClient: WALLET.ALGO;
let mccClient: MCC.ALGO;

const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";
const fundedPrivateKey = "UvwtoiKaq8lbnS7EFJilRLDJrP5CxALEFX33OkPEq3qfrVez9lmfsaA2a3a0mFRrCxj74a16pst1T08iAhuCpg";
const targetAddress = "O2GT7KTTT7ESYYR6CJ23QQHXCVNV5W3MGYOYA2MGBPND5MB2BOPGVKFTLE";
const targetPrivateKey = "9BgYnNJDoyja61qVaEkoiKB41dD6XGCi7cKADtpq/tt2jT+qc5/JLGI+EnW4QPcVW17bbDYdgGmGC9o+sDoLng==";

const ALGOWalletConnectionTest = {
    algod: {
        url: process.env.ALGO_ALGOD_URL_TESTNET || "",
        token: process.env.ALGO_ALGOD_TOKEN_TESTNET || ""
     },
};

const ALGOMccConnectionTest = {
    algod: {
        url: process.env.ALGO_ALGOD_URL_TESTNET_MCC || "",
        token: "",
    },
    indexer: {
        url: process.env.ALGO_INDEXER_URL_TESTNET_MCC || "",
        token: "",
    },
};

const amountToSendALGO = 1;

describe("ALGO wallet tests", async () => {

    before(async () => {
        rootPc = await PersistenceContext.create();
        pc = rootPc.clone();
        dbWallet = new DBWalletKeys(pc);
        walletClient = new WALLET.ALGO(ALGOWalletConnectionTest);
        mccClient = new MCC.ALGO(ALGOMccConnectionTest);
        blockChainHelper = new BlockChainHelper(walletClient, mccClient);
        walletHelper = new BlockChainWalletHelper(walletClient, pc, blockChainHelper);
    })

    it("Should insert address and private key into db", async () => {
        await dbWallet.addKey(fundedAddress, fundedPrivateKey);
        await dbWallet.addKey(targetAddress, targetPrivateKey);
        const targetPrivateKeyFromDb = await dbWallet.getKey(targetAddress);
        const fundedPrivateKeyFromDb = await dbWallet.getKey(fundedAddress);
        expect(targetPrivateKeyFromDb).to.equal(targetPrivateKey);
        expect(fundedPrivateKeyFromDb).to.equal(fundedPrivateKey);
    });

    it("Should send funds and retrieve transaction", async () => {
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendALGO, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
