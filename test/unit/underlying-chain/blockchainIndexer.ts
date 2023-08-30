import { expect, use } from "chai";
import { BlockchainIndexerHelper } from "../../../src/underlying-chain/BlockchainIndexerHelper";
import { TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
import { requireEnv, toBN } from "../../../src/utils/helpers";
import { receiveBlockAndTransaction } from "../../test-utils/test-helpers";
const rewiredBlockchainIndexerHelper = rewire("../../../src/underlying-chain/BlockchainIndexerHelper");
const rewiredBlockchainIndexerHelperClass = rewiredBlockchainIndexerHelper.__get__("BlockchainIndexerHelper");
import chaiAsPromised from "chai-as-promised";
import { createBlockchainIndexerHelper } from "../../../src/config/BotConfig";
use(chaiAsPromised);

describe("XRP blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.XRP;
    const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/xrp";
    let rewiredBlockChainIndexerClient: typeof rewiredBlockchainIndexerHelperClass;
    let blockchainIndexerClient: BlockchainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockchainIndexerHelperClass("", sourceId, "");
        blockchainIndexerClient = createBlockchainIndexerHelper(sourceId, indexerUrl);
        // TODO could be done better
        const info = await receiveBlockAndTransaction(sourceId, blockchainIndexerClient, indexerUrl);
        if (info) {
            blockId = info?.blockNumber;
            blockHash = info?.blockHash;
            txHash = info!.txHash!;
        }
    });

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockchainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockchainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (hash)", async () => {
        const blHash = "50DD4ED48D22EB7232C836FBC25B33DB5A7345E139DB7E967717D76606103E1C";
        const retrievedBlock = await blockchainIndexerClient.getBlock(blHash);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockchainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (number)", async () => {
        const blockNumber = 38760363;
        const retrievedBlock = await blockchainIndexerClient.getBlockAt(blockNumber);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockchainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockchainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash.toLocaleUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

    it("Should not retrieve transaction block", async () => {
        const transactionHash = "236DDA439C92DE126B549F5DFD1B813C8F1E68A94B27BFBD3B830B16B26C83DA";
        const transactionBlock = await blockchainIndexerClient.getTransactionBlock(transactionHash);
        expect(transactionBlock).to.be.null;
    });

    it("Should return appropriate status", async () => {
        const data = {
            response: {
                data: {
                    result: {
                        meta: {
                            AffectedNodes: [{ ModifiedNode: [Object] }, { ModifiedNode: [Object] }],
                            TransactionIndex: 1,
                            TransactionResult: "tesSUCCESS",
                            delivered_amount: "1000000",
                        },
                    },
                },
            },
        };
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_SUCCESS);
        data.response.data.result.meta.TransactionResult = "tec";
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_FAILED);
        data.response.data.result.meta.TransactionResult = "tem";
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_FAILED);
        data.response.data.result.meta.TransactionResult = "tecDST_TAG_NEEDED";
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
        data.response.data.result.meta.TransactionResult = "tecNO_DST";
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
        data.response.data.result.meta.TransactionResult = "tecNO_DST_INSUF_XRP";
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
        data.response.data.result.meta.TransactionResult = "tecNO_PERMISSION";
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
    });

    it("Should return inputs/outputs accordingly", async () => {
        const data = {
            isNativePayment: true,
            response: {
                data: {
                    result: {
                        Account: "rQ3fNyLjbvcDaPNS4EAJY8aT9zR3uGk17c",
                        Amount: 100,
                        Destination: "rQ3fNyLjbvcDaPNS4EAJY8aT9zR3uGk17c",
                        meta: {
                            delivered_amount: "100",
                            TransactionResult: "tesSUCCESS",
                        },
                    },
                },
            },
        };
        const dataWithFee = {
            isNativePayment: true,
            response: {
                data: {
                    result: {
                        Account: "rQ3fNyLjbvcDaPNS4EAJY8aT9zR3uGk17c",
                        Amount: 100,
                        Fee: 15,
                        meta: {
                            delivered_amount: "100",
                            TransactionResult: "tesSUCCESS",
                        },
                    },
                },
            },
        };
        const inputs = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, true);
        expect(inputs[0][0]).to.eq(data.response.data.result.Account);
        expect(inputs[0][1].eqn(data.response.data.result.Amount)).to.be.true;

        const inputsWithFee = rewiredBlockChainIndexerClient.XRPInputsOutputs(dataWithFee, true);
        expect(inputsWithFee[0][0]).to.eq(dataWithFee.response.data.result.Account);
        expect(inputsWithFee[0][1].eqn(dataWithFee.response.data.result.Amount + dataWithFee.response.data.result.Fee)).to.be.true;

        const outputs = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, false);
        expect(outputs[0][0]).to.eq(data.response.data.result.Account);
        expect(outputs[0][1].eq(toBN(data.response.data.result.meta.delivered_amount))).to.be.true;

        data.isNativePayment = false;
        const inputsNotNativePayment = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, true);
        expect(inputsNotNativePayment[0][0]).to.eq(data.response.data.result.Account);
        expect(inputsNotNativePayment[0][1].eqn(0)).to.be.true;

        dataWithFee.isNativePayment = false;
        const inputsWithFeeNotNativePayment = rewiredBlockChainIndexerClient.XRPInputsOutputs(dataWithFee, true);
        expect(inputsWithFeeNotNativePayment[0][0]).to.eq(data.response.data.result.Account);
        expect(inputsWithFeeNotNativePayment[0][1].eqn(dataWithFee.response.data.result.Fee)).to.be.true;

        const outputsNotNativePayment = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, false);
        expect(outputsNotNativePayment[0][0]).to.eq("");
        expect(outputsNotNativePayment[0][1].eqn(0)).to.be.true;
    });

    it("Should wait for underlying transaction finalization", async () => {
        if (txHash) {
            const retrievedTransaction = await blockchainIndexerClient.waitForUnderlyingTransactionFinalization(txHash, 3);
            expect(txHash).to.be.eq(retrievedTransaction?.hash);
        }
    });

    it("Should wait for underlying transaction finalization 2", async () => {
        const retrievedTransaction = await blockchainIndexerClient.waitForUnderlyingTransactionFinalization("txHash", 0);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should not get balance - not implemented", async () => {
        await expect(blockchainIndexerClient.getBalance())
            .to.eventually.be.rejectedWith("Method not implemented on indexer. Use wallet.")
            .and.be.an.instanceOf(Error);
    });

    it("Should get transaction by reference - empty array", async () => {
        const retrievedTransaction1 = await blockchainIndexerClient.getTransactionsByReference("txHash");
        expect(retrievedTransaction1.length).to.be.gte(0);
    });

    it("Should get transactions within block range", async () => {
        const offset = 10;
        const retrievedTransaction1 = await blockchainIndexerClient.getTransactionsWithinBlockRange(blockId - offset, blockId);
        expect(retrievedTransaction1.length).to.be.gte(1);
    });
});

describe("LTC blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.LTC;
    it("Should not create blockChainIndexerHelper - not supported chain id", async () => {
        const fn = () => {
            return createBlockchainIndexerHelper(sourceId, "");
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

    it("Should not handle inputs and outputs - not supported chain id", async () => {
        const rewiredBlockChainIndexerClient = new rewiredBlockchainIndexerHelperClass("", sourceId, "");
        await expect(rewiredBlockChainIndexerClient.handleInputsOutputs({ transactionType: "type", response: { data: {} } }))
            .to.eventually.be.rejectedWith(`Invalid SourceId: ${sourceId}.`)
            .and.be.an.instanceOf(Error);
    });
});

describe("DOGE blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.DOGE;
    const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/doge/";
    let rewiredBlockChainIndexerClient: typeof rewiredBlockchainIndexerHelperClass;
    let blockChainIndexerClient: BlockchainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockchainIndexerHelperClass("", sourceId, "");
        blockChainIndexerClient = createBlockchainIndexerHelper(sourceId, indexerUrl);
        // TODO could be done better
        const info = await receiveBlockAndTransaction(sourceId, blockChainIndexerClient, indexerUrl);
        if (info) {
            blockId = info?.blockNumber;
            blockHash = info?.blockHash;
            txHash = info!.txHash!;
        }
    });

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash.toLocaleUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

    it("Should return appropriate status", async () => {
        expect(rewiredBlockChainIndexerClient.successStatus({ data: "data" })).to.eq(TX_SUCCESS);
    });
});

describe("BTC blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.BTC;
    const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/btc/";
    let rewiredBlockChainIndexerClient: typeof rewiredBlockchainIndexerHelperClass;
    let blockChainIndexerClient: BlockchainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockchainIndexerHelperClass(indexerUrl, sourceId, requireEnv("INDEXER_API_KEY"));
        blockChainIndexerClient = createBlockchainIndexerHelper(sourceId, indexerUrl);
        // TODO could be done better
        const info = await receiveBlockAndTransaction(sourceId, blockChainIndexerClient, indexerUrl);
        if (info) {
            blockId = info?.blockNumber;
            blockHash = info?.blockHash;
            txHash = info!.txHash!;
        }
    });

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash.toLocaleUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

    it("Should return inputs/outputs accordingly", async () => {
        const responseData = {
            blockhash: "000000000000477220a2eb2d74cf9840cf6b9f720cd706cca4b9c272aaa455df",
            blocktime: 1688214011,
            confirmations: 5,
            fee: 0.00000481,
            hash: "72072e1315e525b23060dfac7947692083755c8dd4b36b552a6c0cbe8442c0db",
            hex: "02000000000102b27f3ad90280a31dea366efc8c97ed1e94d4ba36ad1721c7b9c0817971a8fbb80100000017160014bb6f51d0e9ca4971c3f996c389586145f083533dfefffffff89901d026f3eb73ae65424417a92dd840ab0c3c8870e09f2f2270c974978e2c030000006a473044022036792532c9f26e6127bd88c2b416d56f014abd8ee9537066bc49ef0a7f7d7bbb022044b2837a7f5f8ece17fcae6e3773842e069c8a5598cad0dcf548042f2ef9aeb9012103eab162df45c5354ade110d764e2e06d25e0b67c5e24afe0b21b15e00c268ba0bfeffffff0740a301000000000017a914b5dcdebc745f68e93e344cad411383389b15f42b870d9f0100000000001976a914573a49bc303b276996af9247dabbda0a80836ada88accb9d0100000000001976a91457905ca9e3602de7cae446f51d6f336141c5868388ac12a601000000000017a914565289c10f4d5a6f91a5170eebefd177150da87b87fcec10000000000017a914c848a3ccf94e1fe3ce820c27435b0aa61a13fc96875a960100000000001976a91426a4e12633c2c53e9f6bacfe94f33f5dc6a77e3588ac48870100000000001976a914d603ba8fbb0e12fb8f5d241ec8a75dd52db54cd788ac02473044022024d7ce738b190c3d6f81cb3fb88794d7c21707ffdf06083abfa76b28e03a83b302205751ce4861f581fe1666eeb9c9647aef63bd9a614424c7da418e10153fdb26ef0121033c257c008301aeb614d69d5bd3aa0bef528705d3e22c7fc628d74e54abac537300dd3a2500",
            locktime: 2439901,
            size: 563,
            time: 1688214011,
            txid: "31000edd8759f5ea13c98870170439c650c6927e0d1d30a7dfb880bad9447039",
            version: 2,
            vin: [
                {
                    scriptSig: {
                        asm: "0014bb6f51d0e9ca4971c3f996c389586145f083533d",
                        hex: "160014bb6f51d0e9ca4971c3f996c389586145f083533d",
                    },
                    sequence: 4294967294,
                    txid: "b8fba8717981c0b9c72117ad36bad4941eed978cfc6e36ea1da38002d93a7fb2",
                    txinwitness: [
                        "3044022024d7ce738b190c3d6f81cb3fb88794d7c21707ffdf06083abfa76b28e03a83b302205751ce4861f581fe1666eeb9c9647aef63bd9a614424c7da418e10153fdb26ef01",
                        "033c257c008301aeb614d69d5bd3aa0bef528705d3e22c7fc628d74e54abac5373",
                    ],
                    vout: 1,
                },
                {
                    scriptSig: {
                        asm: "3044022036792532c9f26e6127bd88c2b416d56f014abd8ee9537066bc49ef0a7f7d7bbb022044b2837a7f5f8ece17fcae6e3773842e069c8a5598cad0dcf548042f2ef9aeb9[ALL] 03eab162df45c5354ade110d764e2e06d25e0b67c5e24afe0b21b15e00c268ba0b",
                        hex: "473044022036792532c9f26e6127bd88c2b416d56f014abd8ee9537066bc49ef0a7f7d7bbb022044b2837a7f5f8ece17fcae6e3773842e069c8a5598cad0dcf548042f2ef9aeb9012103eab162df45c5354ade110d764e2e06d25e0b67c5e24afe0b21b15e00c268ba0b",
                    },
                    sequence: 4294967294,
                    txid: "2c8e9774c970222f9fe070883c0cab40d82da917444265ae73ebf326d00199f8",
                    vout: 3,
                },
            ],
            vout: [
                {
                    n: 0,
                    scriptPubKey: {
                        address: "2N9pptKsrwwgxbEF58Wxekf2FSitKe45wVV",
                        asm: "OP_HASH160 b5dcdebc745f68e93e344cad411383389b15f42b OP_EQUAL",
                        desc: "addr(2N9pptKsrwwgxbEF58Wxekf2FSitKe45wVV)#gmzrh8n8",
                        hex: "a914b5dcdebc745f68e93e344cad411383389b15f42b87",
                        type: "scripthash",
                    },
                    value: 0.00107328,
                },
                {
                    n: 1,
                    scriptPubKey: {
                        address: "moUAufc9bcXg1LseNo8W9kARD8qyn9nSkq",
                        asm: "OP_DUP OP_HASH160 573a49bc303b276996af9247dabbda0a80836ada OP_EQUALVERIFY OP_CHECKSIG",
                        desc: "addr(moUAufc9bcXg1LseNo8W9kARD8qyn9nSkq)#hd23jv9y",
                        hex: "76a914573a49bc303b276996af9247dabbda0a80836ada88ac",
                        type: "pubkeyhash",
                    },
                    value: 0.00106253,
                },
                {
                    n: 2,
                    scriptPubKey: {
                        address: "moVx2BthpyVEsd4cfjgmq184UUrRJP5kzD",
                        asm: "OP_DUP OP_HASH160 57905ca9e3602de7cae446f51d6f336141c58683 OP_EQUALVERIFY OP_CHECKSIG",
                        desc: "addr(moVx2BthpyVEsd4cfjgmq184UUrRJP5kzD)#m67l4v7u",
                        hex: "76a91457905ca9e3602de7cae446f51d6f336141c5868388ac",
                        type: "pubkeyhash",
                    },
                    value: 0.00105931,
                },
                {
                    n: 3,
                    scriptPubKey: {
                        address: "2N17eydT2ENxcwYoMys6har4RBc8Fa5JGe3",
                        asm: "OP_HASH160 565289c10f4d5a6f91a5170eebefd177150da87b OP_EQUAL",
                        desc: "addr(2N17eydT2ENxcwYoMys6har4RBc8Fa5JGe3)#fgmddf3y",
                        hex: "a914565289c10f4d5a6f91a5170eebefd177150da87b87",
                        type: "scripthash",
                    },
                    value: 0.0010805,
                },
                {
                    n: 4,
                    scriptPubKey: {
                        address: "2NBWE9kkEC8YK537Xv6RzUtipR1kX2MXKs1",
                        asm: "OP_HASH160 c848a3ccf94e1fe3ce820c27435b0aa61a13fc96 OP_EQUAL",
                        desc: "addr(2NBWE9kkEC8YK537Xv6RzUtipR1kX2MXKs1)#le9k9psu",
                        hex: "a914c848a3ccf94e1fe3ce820c27435b0aa61a13fc9687",
                        type: "scripthash",
                    },
                    value: 0.01109244,
                },
                {
                    n: 5,
                    scriptPubKey: {
                        address: "mj3HVNVP4Q8uKtCrVPGfJFUoKMQ5GG8saJ",
                        asm: "OP_DUP OP_HASH160 26a4e12633c2c53e9f6bacfe94f33f5dc6a77e35 OP_EQUALVERIFY OP_CHECKSIG",
                        desc: "addr(mj3HVNVP4Q8uKtCrVPGfJFUoKMQ5GG8saJ)#ps5f6hgh",
                        hex: "76a91426a4e12633c2c53e9f6bacfe94f33f5dc6a77e3588ac",
                        type: "pubkeyhash",
                    },
                    value: 0.00104026,
                },
                {
                    n: 6,
                    scriptPubKey: {
                        address: "n12ZNBdxNL8Jo6533midaXviJ3n9EXqjAP",
                        asm: "OP_DUP OP_HASH160 d603ba8fbb0e12fb8f5d241ec8a75dd52db54cd7 OP_EQUALVERIFY OP_CHECKSIG",
                        desc: "addr(n12ZNBdxNL8Jo6533midaXviJ3n9EXqjAP)#0z3j988m",
                        hex: "76a914d603ba8fbb0e12fb8f5d241ec8a75dd52db54cd788ac",
                        type: "pubkeyhash",
                    },
                    value: 0.00100168,
                },
            ],
            vsize: 481,
            weight: 1922,
        };

        const resInput = await rewiredBlockChainIndexerClient.UTXOInputsOutputs("payment", responseData, true);
        expect(resInput[0][0]).to.eq("");
        expect(resInput[0][1].eq(toBN(0))).to.be.true;
        const resOutput = await rewiredBlockChainIndexerClient.UTXOInputsOutputs("payment", responseData, false);
        expect(resOutput.length).to.eq(responseData.vout.length);
        responseData.vout = [];
        const resOutputEmpty = await rewiredBlockChainIndexerClient.UTXOInputsOutputs("payment", responseData, false);
        expect(resOutputEmpty[0][0]).to.eq("");
        expect(resOutputEmpty[0][1].eq(toBN(0))).to.be.true;
    });
});
