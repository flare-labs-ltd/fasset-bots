import { sleep, web3 } from "../utils";
import { getUnixEpochTimestamp, waitFinalize } from "../utils/utils";
import { logger } from "../utils/logger";
import { FeedResult } from "../config/PricePublisherConfig";
import axios from 'axios';
import { PricePublisherState } from "../entities/agent";
import { EM } from "../config/orm";
import { waitFinalizeOptions } from "../config";

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
        private privateKey: string,
        private maxDelayMs: number,
        private feedApiPath: string,
        private apiKey: string
    ) {
        this.waitFinalize3 = waitFinalize(web3, waitFinalizeOptions);
    }

    private pending: number = 0;
    private running = false;
    rps = 3;
    batchSize = 30;

    waitFinalize3: (sender: string, func: () => any, delay?: number) => Promise<any>;

    public async getContract(name: string): Promise<any> {
        return this.contractsMap.get(name);
    }

    start() {
        this.running = true;
        void this.run(this.rps, this.batchSize);
    }

    stop() {
        this.running = false;
    }

    public async run(rps: number, batchSize: number) {
        logger.info(`waiting for network connection...`);
        let nextBlockToProcess: number;
        let firstRun = true;

        // eslint-disable-next-line no-constant-condition
        while (this.running) {
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
                    await sleep(4000);
                    continue;
                }

                const endBlock = Math.min(nextBlockToProcess + batchSize - 1, currentBlockNumber);
                // https://flare-api.flare.network has rate limit 200 rpm
                await sleep(2000 / rps);
                const contractsEventBatches = await this.getEventsFromBlocks(
                    ["Relay"],
                    nextBlockToProcess,
                    endBlock
                );
                for (const contractEventBatch of contractsEventBatches) {
                    await this.processEvents(contractEventBatch);
                }
                await this.saveLastProcessedBlock(endBlock);
                await this.removePreviousProcessedBlock();
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
            return currentBlockNumber - 1;
        }
        return res.valueNumber;
    }

    async removePreviousProcessedBlock() {
        const res = await this.entityManager.getRepository(PricePublisherState).find(
            { name: 'lastProcessedBlock' },
            { orderBy: { id: 'ASC' } }
        );
        // if there is more than one record (should be at most two), remove the oldest one
        if (res.length > 1) {
            await this.entityManager.removeAndFlush(res[0]);
        }
    }

    private async saveLastProcessedBlock(newLastProcessedBlock: number) {
        const state = new PricePublisherState();
        state.name = 'lastProcessedBlock';
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
                    logger.info(`Event ProtocolMessageRelayed emitted for voting round: ${params.votingRoundId} in block ${event.blockNumber}`);
                    await this.getFeedData(Number(params.votingRoundId));
                }
            }
        }
    }

    private async getFeedData(votingRoundId: number) {
        const ftsoV2PriceStore = await this.getContract("FtsoV2PriceStore");
        const feedIds = await ftsoV2PriceStore.methods.getFeedIds().call();

        const response = await axios.post(`${this.feedApiPath}?$voting_round_id=${votingRoundId}`, {
            feed_ids: feedIds
        }, {
            headers: {
                'x-api-key': this.apiKey
            }
        });
        // get data
        const feedsData: { data: FeedResult; proof: string[] }[] = response.data;
        const feedsDataRenamed: { body: FeedResult; merkleProof: string[] }[] = feedsData.map(({data, proof}) => ({body: data, merkleProof: proof}));
        // sort nodes by order of feedIds array
        feedsDataRenamed.sort((a: any, b: any) => feedIds.indexOf(a.body.id) - feedIds.indexOf(b.body.id));
        // random delay between 0 and maxDelayMs
        await sleep(Math.random() * this.maxDelayMs);
        // check if prices are already published
        const lastPublishedVotingRoundId = await ftsoV2PriceStore.methods.lastPublishedVotingRoundId().call();
        if (lastPublishedVotingRoundId >= votingRoundId) {
            logger.info(`Prices for voting round ${votingRoundId} already published`);
            return;
        }
        await this.publishFeeds(feedsDataRenamed);
    }

    private async publishFeeds(nodes: any[]): Promise<boolean> {
        const wallet = web3.eth.accounts.privateKeyToAccount(this.privateKey);
        const ftsoV2PriceStore = await this.getContract("FtsoV2PriceStore");
        const fnToEncode = ftsoV2PriceStore.methods.publishPrices(nodes);
        return await this.signAndFinalize3(wallet, ftsoV2PriceStore.options.address, fnToEncode);
    }

    private async signAndFinalize3(fromWallet: any, toAddress: string, fnToEncode: any): Promise<boolean> {
        const nonce = Number((await web3.eth.getTransactionCount(fromWallet.address)));
        // getBlockNumber sometimes returns a block beyond head block
        const lastBlock = await web3.eth.getBlockNumber() - 3;
        // get fee history for the last 50 blocks
        let gasPrice: bigint;
        try {
            const feeHistory = await web3.eth.getFeeHistory(50, lastBlock, [0]);
            const baseFee = feeHistory.baseFeePerGas;
            // get max fee of the last 50 blocks
            let maxFee = BigInt(0);
            for (const fee of baseFee) {
                if (BigInt(fee) > maxFee) {
                    maxFee = BigInt(fee);
                }
            }
            gasPrice = maxFee * BigInt(3);
        } catch (e) {
            logger.info("using getFeeHistory failed; will use getGasPrice instead");
            gasPrice = BigInt(await web3.eth.getGasPrice()) * BigInt(5);
        }

        const rawTX = {
            nonce: nonce,
            from: fromWallet.address,
            to: toAddress,
            gas: "8000000",
            gasPrice: gasPrice.toString(),
            data: fnToEncode.encodeABI()
        };
        const signedTx = await fromWallet.signTransaction(rawTX);

        try {
            this.pending++;
            logger.info(`Send - pending: ${this.pending}, nonce: ${nonce}, from ${fromWallet.address}, to contract ${toAddress}`);
            await this.waitFinalize3(fromWallet.address, async () => web3.eth.sendSignedTransaction(signedTx.rawTransaction));
            // this.logger.info("gas used " + JSON.stringify(receipt.gasUsed, bigIntReplacer));
            return true;
        } catch (e: any) {
            if ("innerError" in e && e.innerError != undefined && "message" in e.innerError) {
                logger.info("from: " + fromWallet.address + " | to: " + toAddress + " | signAndFinalize3 error: " + e.innerError.message);
            } else if ("reason" in e && e.reason != undefined) {
                logger.info("from: " + fromWallet.address + " | to: " + toAddress + " | signAndFinalize3 error: " + e.reason);
            } else {
                logger.info(fromWallet.address + " | signAndFinalize3 error: " + e);
                // console.dir(e);
            }
            return false;
        }
    }
}