import axios from 'axios';
import { FtsoV2PriceStoreInstance } from '../../typechain-truffle';
import { BotConfigFile, loadContracts, Secrets } from '../config';
import { artifacts, assertNotNullCmd, requireNotNull, sleep, web3 } from "../utils";
import { logger, loggerAsyncStorage } from "../utils/logger";

export const DEFAULT_PRICE_PUBLISHER_LOOP_DELAY_MS = 1000;

const FtsoV2PriceStore = artifacts.require("FtsoV2PriceStore");

export interface FeedResult {
    readonly votingRoundId: number | string;
    readonly id: string; // Needs to be 0x-prefixed for abi encoding
    readonly value: number | string;
    readonly turnoutBIPS: number | string;
    readonly decimals: number | string;
}

export interface FeedResultWithProof {
    body: FeedResult;
    merkleProof: string[];
}

export interface LatestRoundResult {
    voting_round_id: number | string;
    start_timestamp: number | string;
}

export interface FspStatusResult {
    active: LatestRoundResult;
    latest_fdc: LatestRoundResult;
    latest_ftso: LatestRoundResult;
}

export class PricePublisherService {

    constructor(
        private ftsoV2PriceStore: FtsoV2PriceStoreInstance,
        private publisherAddress: string,
        private priceFeedApiUrls: string[],
        private apiKey: string,
        private loopDelayMs: number,
    ) {
    }

    running = false;
    stopped = false;

    static async create(runConfig: BotConfigFile, secrets: Secrets, pricePublisherAddress: string) {
        assertNotNullCmd(runConfig.priceFeedApiUrls, "Missing priceFeedApiPath");
        assertNotNullCmd(runConfig.contractsJsonFile, "Contracts file is required for price publisher");
        const contracts = loadContracts(runConfig.contractsJsonFile);
        const publisherApiKey = secrets.optional("apiKey.price_publisher_api") ?? "";
        const maxDelayMs = runConfig.pricePublisherLoopDelayMs ?? DEFAULT_PRICE_PUBLISHER_LOOP_DELAY_MS;
        const ftsoV2PriceStore = await FtsoV2PriceStore.at(contracts.FtsoV2PriceStore.address);
        const pricePublisherService = new PricePublisherService(ftsoV2PriceStore, pricePublisherAddress, runConfig.priceFeedApiUrls, publisherApiKey, maxDelayMs);
        return pricePublisherService;
    }

    start() {
        this.running = true;
        void loggerAsyncStorage.run("price-publisher", () => this.run());
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
                const lastAvailableRoundId = await this.getLastAvailableRoundId();
                const lastPublishedRoundId = Number(await this.ftsoV2PriceStore.lastPublishedVotingRoundId());
                if (lastAvailableRoundId > lastPublishedRoundId) {
                    await this.getAndPublishFeedData(lastAvailableRoundId);
                }
                await sleep(this.loopDelayMs);
            } catch (error) {
                logger.error(`Error in publishing prices: ${error}`);
            }
        }
        this.stopped = true;
        logger.info(`Price publishing service stopped.`);
        console.log(`Price publishing service stopped.`);
    }

    async getLastAvailableRoundId() {
        let lastRoundId = -1;
        for (const url of this.priceFeedApiUrls) {
            try {
                const response = await axios.get<FspStatusResult>(`${url}/api/v0/fsp/status`, {
                    headers: {
                        'x-api-key': this.apiKey
                    }
                });
                const roundId = Number(requireNotNull(response.data.latest_ftso.voting_round_id));
                lastRoundId = Math.max(lastRoundId, roundId);
            } catch (error) {
                logger.error(`Problem getting last price feed round id at ${url}: ${error}`);
            }
        }
        if (lastRoundId < 0) {
            throw new Error(`No working price feed providers.`);
        }
        return lastRoundId;
    }

    async getFeedData(votingRoundId: number, feedIds: string[]) {
        let errors = 0;
        for (const url of this.priceFeedApiUrls) {
            try {
                const feeds = await this.getFeedDataForUrl(url, votingRoundId, feedIds);
                if (feeds != null) {
                    return feeds;
                }
            } catch (error) {
                logger.error(`Problem getting price feed at ${url}: ${error}`);
                ++errors;
            }
        }
        if (errors === this.priceFeedApiUrls.length) {
            throw new Error(`No working price feed providers.`);
        }
        return null;
    }

    private async getFeedDataForUrl(url: string, votingRoundId: number, feedIds: string[]): Promise<FeedResultWithProof[] | null> {
        const response = await axios.post(`${url}/api/v0/ftso/anchor-feeds-with-proof?voting_round_id=${votingRoundId}`, {
            feed_ids: feedIds
        }, {
            headers: {
                'x-api-key': this.apiKey
            }
        });
        // get data
        const feedsData: { data: FeedResult; proof: string[]; }[] = response.data;
        // check that voting round is correct
        if (feedsData.some(fd => Number(fd.data.votingRoundId) !== votingRoundId)) {
            return null;
        }
        // rename data field to body
        const feedsDataRenamed = feedsData.map(fd => ({ body: fd.data, merkleProof: fd.proof }));
        // sort nodes by order of feedIds array
        feedsDataRenamed.sort((a, b) => feedIds.indexOf(a.body.id) - feedIds.indexOf(b.body.id));
        return feedsDataRenamed;
    }

    async getAndPublishFeedData(votingRoundId: number) {
        logger.info(`Publishing prices for ${votingRoundId}`);
        const feedIds = await this.ftsoV2PriceStore.getFeedIds();
        const feedsData = await this.getFeedData(votingRoundId, feedIds);
        if (feedsData != null) {
            const lastPublishedRoundId = Number(await this.ftsoV2PriceStore.lastPublishedVotingRoundId());
            if (votingRoundId > lastPublishedRoundId) {
                const gasPrice = await this.estimateGasPrice();
                await this.ftsoV2PriceStore.publishPrices(feedsData, { from: this.publisherAddress, gasPrice: gasPrice.toString() });
                logger.info(`Prices published for round ${votingRoundId}`);
            } else {
                logger.info(`Prices for round ${votingRoundId} already published`);
            }
        } else {
            logger.info(`No new price data available`);
        }
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
