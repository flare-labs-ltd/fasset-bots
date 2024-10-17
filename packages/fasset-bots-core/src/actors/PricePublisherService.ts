import axios from 'axios';
import { FtsoV2PriceStoreInstance } from '../../typechain-truffle';
import { BotConfigFile, loadContracts, Secrets } from '../config';
import { artifacts, assertNotNullCmd, requireNotNull, sleep, web3 } from "../utils";
import { logger, loggerAsyncStorage } from "../utils/logger";

export const DEFAULT_PRICE_PUBLISHER_MAX_DELAY_MS = 5_000;

const FtsoV2PriceStore = artifacts.require("FtsoV2PriceStore");

export interface FeedResult {
    readonly votingRoundId: number | string;
    readonly id: string; // Needs to be 0x-prefixed for abi encoding
    readonly value: number | string;
    readonly turnoutBIPS: number | string;
    readonly decimals: number | string;
}

export interface LatestRoundResult {
    voting_round_id: number | string;
    timestamp: number | string;
}

interface FeedDataWithRound {
    feeds: {
        body: FeedResult;
        merkleProof: string[];
    }[];
    roundId: number;
}

export class PricePublisherService {

    constructor(
        private ftsoV2PriceStore: FtsoV2PriceStoreInstance,
        private publisherAddress: string,
        private priceFeedApiUrls: string[],
        private apiKey: string,
        private maxDelayMs: number,
    ) {
    }

    running = false;
    stopped = false;

    static async create(runConfig: BotConfigFile, secrets: Secrets, pricePublisherAddress: string) {
        assertNotNullCmd(runConfig.priceFeedApiUrls, "Missing priceFeedApiPath");
        assertNotNullCmd(runConfig.contractsJsonFile, "Contracts file is required for price publisher");
        const contracts = loadContracts(runConfig.contractsJsonFile);
        const publisherApiKey = secrets.optional("apiKey.price_publisher_api") ?? "";
        const maxDelayMs = runConfig.pricePublisherMaxDelayMs ?? DEFAULT_PRICE_PUBLISHER_MAX_DELAY_MS;
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
        let prevAvailableRoundId = -1;
        while (this.running) {
            try {
                const lastAvailableRoundId = await this.getLastAvailableRoundId();
                if (lastAvailableRoundId > prevAvailableRoundId) {
                    await this.getAndPublishFeedData(lastAvailableRoundId);
                    prevAvailableRoundId = lastAvailableRoundId;
                }
                await sleep(Math.round(Math.random() * this.maxDelayMs));
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
                const response = await axios.get<LatestRoundResult>(`${url}/api/v0/fsp/latest-voting-round`, {
                    headers: {
                        'x-api-key': this.apiKey
                    }
                });
                const roundId = Number(requireNotNull(response.data.voting_round_id));
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
        let latest: FeedDataWithRound | null = null;
        for (const url of this.priceFeedApiUrls) {
            try {
                const feed = await this.getFeedDataForUrl(url, votingRoundId, feedIds);
                if (feed.roundId === votingRoundId) {
                    return feed;
                }
                if (latest == null || feed.roundId > latest.roundId) {
                    latest = feed;
                }
            } catch (error) {
                logger.error(`Problem getting price feed at ${url}: ${error}`);
            }
        }
        if (latest == null) {
            throw new Error(`No working price feed providers.`);
        }
        return latest;
    }

    private async getFeedDataForUrl(url: string, votingRoundId: number, feedIds: string[]): Promise<FeedDataWithRound> {
        const response = await axios.post(`${url}/api/v0/ftso/anchor-feeds-with-proof?voting_round_id=${votingRoundId}`, {
            feed_ids: feedIds
        }, {
            headers: {
                'x-api-key': this.apiKey
            }
        });
        // get data
        const feedsData: { data: FeedResult; proof: string[]; }[] = response.data;
        // make sure the data is fresh - at least one price point must be from this round or newer
        const maxRoundId = Math.max(-1, ...feedsData.map(fd => Number(fd.data.votingRoundId)));
        if (maxRoundId < 0) {
            throw new Error(`Empty feed`);
        }
        // filter the feeds with max round id
        const feedsDataRenamed = feedsData
            .filter(fd => Number(fd.data.votingRoundId) === maxRoundId)
            .map(fd => ({ body: fd.data, merkleProof: fd.proof }));
        // sort nodes by order of feedIds array
        feedsDataRenamed.sort((a, b) => feedIds.indexOf(a.body.id) - feedIds.indexOf(b.body.id));
        return { feeds: feedsDataRenamed, roundId: maxRoundId };
    }

    async getAndPublishFeedData(votingRoundId: number) {
        logger.info(`Publishing prices for ${votingRoundId}`);
        const feedIds = await this.ftsoV2PriceStore.getFeedIds();
        const feedsData = await this.getFeedData(votingRoundId, feedIds);
        const lastPublishedRoundId = Number(await this.ftsoV2PriceStore.lastPublishedVotingRoundId());
        if (feedsData.roundId > lastPublishedRoundId) {
            const gasPrice = await this.estimateGasPrice();
            await this.ftsoV2PriceStore.publishPrices(feedsData.feeds, { from: this.publisherAddress, gasPrice: gasPrice.toString() });
            logger.info(`Prices published for round ${votingRoundId} (feed round is ${feedsData.roundId})`);
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
