import axios from 'axios';
import { FtsoV2PriceStoreInstance } from '../../typechain-truffle';
import { BotConfigFile, loadContracts, Secrets } from '../config';
import { artifacts, assertNotNullCmd, requireNotNull, sleep, web3 } from "../utils";
import { logger } from "../utils/logger";

export const DEFAULT_PRICE_PUBLISHER_MAX_DELAY_MS = 5_000;

const FtsoV2PriceStore = artifacts.require("FtsoV2PriceStore");

export interface FeedResult {
    readonly votingRoundId: number;
    readonly id: string; // Needs to be 0x-prefixed for abi encoding
    readonly value: number;
    readonly turnoutBIPS: number;
    readonly decimals: number;
}

export interface LatestRoundResult {
    voting_round_id: number;
    timestamp: number;
}

export class PricePublisherService {

    constructor(
        private ftsoV2PriceStore: FtsoV2PriceStoreInstance,
        private publisherAddress: string,
        private priceFeedApiUrl: string,
        private apiKey: string,
        private maxDelayMs: number,
    ) {
    }

    running = false;
    stopped = false;

    static async create(runConfig: BotConfigFile, secrets: Secrets, pricePublisherAddress: string) {
        assertNotNullCmd(runConfig.priceFeedApiUrl, "Missing priceFeedApiPath");
        assertNotNullCmd(runConfig.contractsJsonFile, "Contracts file is required for price publisher");
        const contracts = loadContracts(runConfig.contractsJsonFile);
        const publisherApiKey = secrets.optional("apiKey.price_publisher_api") ?? "";
        const maxDelayMs = runConfig.pricePublisherMaxDelayMs ?? DEFAULT_PRICE_PUBLISHER_MAX_DELAY_MS;
        const ftsoV2PriceStore = await FtsoV2PriceStore.at(contracts.FtsoV2PriceStore.address);
        const pricePublisherService = new PricePublisherService(ftsoV2PriceStore, pricePublisherAddress, runConfig.priceFeedApiUrl, publisherApiKey, maxDelayMs);
        return pricePublisherService;
    }

    start() {
        this.running = true;
        void this.run();
    }

    async stop() {
        this.running = false;
        while (!this.stopped) {
            await sleep(100);
        }
    }

    public async run() {
        logger.info(`Started price publishing service...`);
        console.log(`Started price publishing service...`);
        this.stopped = false;
        while (this.running) {
            try {
                const lastPublishedRoundId = Number(await this.ftsoV2PriceStore.lastPublishedVotingRoundId());
                const lastRoundId = await this.getLastAvailableRoundId();
                if (lastRoundId > lastPublishedRoundId) {
                    await this.getAndPublishFeedData(lastRoundId);
                }
                await sleep(Math.random() * this.maxDelayMs);
            } catch (error) {
                logger.error(`Error in publishing prices: ${error}`);
            }
        }
        this.stopped = true;
        logger.info(`Price publishing service stopped.`);
        console.log(`Price publishing service stopped.`);
    }

    async getLastAvailableRoundId() {
        const response = await axios.get<LatestRoundResult>(`${this.priceFeedApiUrl}/api/v0/scaling/latest-voting-round`, {
            headers: {
                'x-api-key': this.apiKey
            }
        });
        return Number(requireNotNull(response.data.voting_round_id));
    }

    async getAndPublishFeedData(votingRoundId: number) {
        logger.info(`Publishing prices for ${votingRoundId}`);
        const feedIds = await this.ftsoV2PriceStore.getFeedIds();
        const feedsData = await this.getFeedData(votingRoundId, feedIds);
        // publish
        const gasPrice = await this.estimateGasPrice();
        await this.ftsoV2PriceStore.publishPrices(feedsData, { from: this.publisherAddress, gasPrice: gasPrice.toString() });
        // log
        logger.info(`Prices published for round ${votingRoundId}`);
    }

    private async getFeedData(votingRoundId: number, feedIds: string[]) {
        const response = await axios.post(`${this.priceFeedApiUrl}/api/v0/scaling/anchor-feeds-with-proof?$voting_round_id=${votingRoundId}`, {
            feed_ids: feedIds
        }, {
            headers: {
                'x-api-key': this.apiKey
            }
        });
        // get data
        const feedsData: { data: FeedResult; proof: string[]; }[] = response.data;
        const feedsDataRenamed: { body: FeedResult; merkleProof: string[]; }[] = feedsData.map(({ data, proof }) => ({ body: data, merkleProof: proof }));
        // sort nodes by order of feedIds array
        feedsDataRenamed.sort((a: any, b: any) => feedIds.indexOf(a.body.id) - feedIds.indexOf(b.body.id));
        return feedsDataRenamed;
    }

    async estimateGasPrice(lastBlock?: number) {
        try {
            lastBlock ??= await web3.eth.getBlockNumber() - 3;
            const feeHistory = await web3.eth.getFeeHistory(50, lastBlock, [0]);
            const baseFee = feeHistory.baseFeePerGas;
            // get max fee of the last 50 blocks
            let maxFee = BigInt(0);
            for (const fee of baseFee) {
                if (BigInt(fee) > maxFee) {
                    maxFee = BigInt(fee);
                }
            }
            return maxFee * BigInt(3);
        } catch (e) {
            logger.warn("Using getFeeHistory failed; will use getGasPrice instead");
            return BigInt(await web3.eth.getGasPrice()) * BigInt(5);
        }
    }
}
