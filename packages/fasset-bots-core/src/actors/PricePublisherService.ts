import { web3 } from "../utils";
import { sleepms, waitFinalize3Factory, getUnixEpochTimestamp } from "../utils/utils";
import { logger } from "../utils/logger";
import { FeedResult, hashPriceFeedResult, hashRandomResult, IPriceFeedData, RandomResult, TreeResult } from "../utils/MerkleTreeStructs";
import axios from 'axios';
import { MerkleTree } from "../utils/MerkleTree";
import { PricePublisherState } from "../entities/pricePublisherState";
import { EM } from "../config/orm";


export interface ContractEventBatch {
    contractName: string;
    startBlock: number;
    endBlock: number;
    events: any[];
}

export class PricePublisherService {

    constructor(
        private entityManager: EM,
        private contractsMap: Map<string, any>,
    ) {
        this.waitFinalize3 = waitFinalize3Factory(web3);
    }

    private pending: number = 0;

    waitFinalize3: (sender: string, func: () => any, delay?: number) => Promise<any>;

    public async getContract(name: string): Promise<any> {
        return this.contractsMap.get(name);
    }

    public async readEvents(rps: number, batchSize: number) {
        logger.info(`waiting for network connection...`);
        let nextBlockToProcess: number;
        let firstRun = true;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                const currentBlockNumber = Number(await web3.eth.getBlockNumber());
                nextBlockToProcess = (await this.getLastProcessedBlock(currentBlockNumber)) + 1;

                if (firstRun) {
                    logger.info(`event processing started | next block to process ${nextBlockToProcess} | current block ${currentBlockNumber}`);
                    firstRun = false;
                }

                // wait for a new block
                if (nextBlockToProcess > currentBlockNumber) {
                    logger.info(`waiting for a new block | next block to process: ${nextBlockToProcess} | last block: ${currentBlockNumber}`);
                    // await sleepms(4000);
                    continue;
                }

                const endBlock = Math.min(nextBlockToProcess + batchSize - 1, currentBlockNumber);
                // https://flare-api.flare.network has rate limit 200 rpm
                await sleepms(2000 / rps);
                const contractsEventBatches = await this.getEventsFromBlocks(
                    ["Relay"],
                    nextBlockToProcess,
                    endBlock
                );
                for (const contractEventBatch of contractsEventBatches) {
                    await this.processEvents(contractEventBatch);
                }
                await this.saveLastProcessedBlock(endBlock);
            } catch (error) {
                logger.error(`Error in EventProcessorService::processEvents: ${error}`);
            }
        }
    }

    async getLastProcessedBlock(currentBlockNumber: number): Promise<number> {
        const res = await this.entityManager.getRepository(PricePublisherState).findOne(
            { name: 'lastProcessedBlock' },
            { orderBy: { id: 'DESC' } }
        );
        if (!res) {
            // if (this.configurationService.indexingStartBlock != null) {
            //     return this.configurationService.indexingStartBlock - 1;
            // }
            return currentBlockNumber - 1;
        }
        return res.valueNumber;
    }

    private async saveLastProcessedBlock(newLastProcessedBlock: number) {
        const state = new PricePublisherState();
        state.name = 'lastProcessedBlock';
        // state.network = this.configurationService.network;
        state.valueNumber = newLastProcessedBlock;
        state.timestamp = getUnixEpochTimestamp();

        await this.entityManager.persistAndFlush(state);
    }

    private async getEventsFromBlockForContract(contractName: string, startBlock: number, endBlock: number): Promise<ContractEventBatch> {
        const contract = await this.getContract(contractName);

        if (!contract) {
            return {
                contractName,
                startBlock,
                endBlock,
                events: [],
            } as ContractEventBatch;
        }

        const events = await contract.getPastEvents('allEvents', { fromBlock: startBlock, toBlock: endBlock });
        if (events.length > 0) {
            logger.info(`${contractName}: ${events.length} new event(s)`);
        }
        return {
            contractName,
            startBlock,
            endBlock,
            events,
        } as ContractEventBatch;
    }

    private async getEventsFromBlocks(contractNames: string[], startBlock: number, endBlock: number): Promise<ContractEventBatch[]> {
        const promises: Promise<ContractEventBatch>[] = [];
        for (const contractName of contractNames) {
            promises.push(this.getEventsFromBlockForContract(contractName, startBlock, endBlock));
        }
        return await Promise.all(promises);
    }

    private async processEvents(batch: any): Promise<any> {
        for (const event of batch.events) {
            if (event.event === 'ProtocolMessageRelayed') {
                const params = event.returnValues;
                // ftso scaling protocol id
                if (params.protocolId == 100) {
                    logger.info(`ProtocolMessageRelayed: ${JSON.stringify(params, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)} in block ${event.blockNumber}`);
                    await this.getFeedData(Number(params.votingRoundId));
                }
            }
        }
    }

    private async getFeedData(votingRoundId: number) {
        const nodes: { body: TreeResult; hash?: string; merkleProof: string[] }[] = [];

        const path = "http://127.0.0.1:31004/data";
        const response = await axios.get(`${path}/${votingRoundId}`, {
            headers: {
                'x-api-key': "abcdef"
            }
        });
        // get data
        const data: IPriceFeedData = response.data;
        const tree: (FeedResult | RandomResult)[] = data.tree;

        for (let i = 0; i < tree.length; i++) {
            if (i == 0) {
                nodes.push({
                    body: tree[i],
                    hash: hashRandomResult(tree[i] as RandomResult),
                    merkleProof: []
                });
            } else {
                nodes.push({
                    body: tree[i],
                    hash: hashPriceFeedResult(tree[i] as FeedResult),
                    merkleProof: []
                });
            }
        }
        const merkleTree = new MerkleTree((nodes as any).map((n: { hash: string }) => n.hash));
        for (const node of nodes) {
            node.merkleProof = merkleTree.getProof(node.hash as any) as any;
            delete node.hash;
        }
        // remove node with random
        nodes.shift();

        // filter out leaves with feedIds for fAssets
        const ftsoV2PriceStore = await this.getContract("FtsoV2PriceStore");
        const feedIds = await ftsoV2PriceStore.methods.getFeedIds().call();
        const nodesFasset = nodes.filter((node: any) => feedIds.includes(node.body.id));
        // sort nodes by order of feedIds array
        nodesFasset.sort((a: any, b: any) => feedIds.indexOf(a.body.id) - feedIds.indexOf(b.body.id));
        await this.publishFeeds(nodesFasset);
    }

    private async publishFeeds(nodes: any[]): Promise<boolean> {
        const wallet = web3.eth.accounts.privateKeyToAccount(process.env.PRICE_PUBLISHER_PRIVATE_KEY as string);
        const ftsoV2PriceStore = await this.getContract("FtsoV2PriceStore");
        const fnToEncode = ftsoV2PriceStore.methods.publishPrices(nodes);
        return await this.signAndFinalize3(wallet, ftsoV2PriceStore.options.address, fnToEncode);
    }

    private async signAndFinalize3(fromWallet: any, toAddress: string, fnToEncode: any): Promise<boolean> {
        const nonce = Number((await web3.eth.getTransactionCount(fromWallet.address)));
        let gasPrice: string | bigint = await web3.eth.getGasPrice();
        gasPrice = BigInt(gasPrice) * BigInt(150) / BigInt(100);
        const rawTX = {
            nonce: nonce,
            from: fromWallet.address,
            to: toAddress,
            gas: "8000000",
            gasPrice: gasPrice.toString(), //"40000000000",
            data: fnToEncode.encodeABI()
        };
        const signedTx = await fromWallet.signTransaction(rawTX);
        // try {
        // 	let estimatedGas = await this.contractService.web3.eth.estimateGas(rawTX);
        // 	this.logger.info("estimated gas: " + estimatedGas);
        // } catch (e) {
        // 	this.logger.error("estimateGas error: " + e);
        // }

        try {
            this.pending++;
            logger.info(`Send - pending: ${this.pending}, nonce: ${nonce}, from ${fromWallet.address}, to contract ${toAddress}`);
            const receipt = await this.waitFinalize3(fromWallet.address, async () => web3.eth.sendSignedTransaction(signedTx.rawTransaction));
            // this.logger.info("gas used " + JSON.stringify(receipt.gasUsed, bigIntReplacer));
            return true;
        } catch (e: any) {
            if ("innerError" in e && e.innerError != undefined && "message" in e.innerError) {
                logger.info("from: " + fromWallet.address + " | to: " + toAddress + " | signAndFinalize3 error: " + e.innerError.message);
            } else if ("reason" in e && e.reason != undefined) {
                logger.info("from: " + fromWallet.address + " | to: " + toAddress + " | signAndFinalize3 error: " + e.reason);
            } else {
                logger.info(fromWallet.address + " | signAndFinalize3 error: " + e);
                console.dir(e);
            }
            return false;
        }
    }
}