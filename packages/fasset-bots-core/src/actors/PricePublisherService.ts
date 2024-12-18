import axios from 'axios';
import { FtsoV2PriceStoreInstance } from '../../typechain-truffle';
import { BotConfigFile, dataAccessLayerApiKey, loadContracts, Secrets } from '../config';
import { artifacts, assertCmd, assertNotNullCmd, errorIncluded, requireNotNull, sleep, web3 } from "../utils";
import { FspStatusResult, FtsoFeedResultWithProof } from '../utils/data-access-layer-types';
import { logger, loggerAsyncStorage } from "../utils/logger";
import { withSettings } from '../utils/mini-truffle-contracts/contracts';

export const DEFAULT_PRICE_PUBLISHER_LOOP_DELAY_MS = 1000;
export const PRICE_PUBLISHING_TIME_RANDOMIZATION_MS = 5000;

const FtsoV2PriceStore = artifacts.require("FtsoV2PriceStore");

export class PricePublisherService {

    constructor(
        private ftsoV2PriceStore: FtsoV2PriceStoreInstance,
        private publisherAddress: string,
        private priceFeedApiUrls: string[],
        private apiKeys: string[],
        private loopDelayMs: number,
    ) {
    }

    running = false;
    stopped = false;

    static async create(runConfig: BotConfigFile, secrets: Secrets, pricePublisherAddress: string) {
        assertNotNullCmd(runConfig.pricePublisherConfig, "Missing pricePublisherConfig");
        assertCmd(runConfig.dataAccessLayerUrls != null && runConfig.dataAccessLayerUrls.length > 0,
            "Field dataAccessLayerUrls must be defined and nonempty for price publisher");
        assertNotNullCmd(runConfig.contractsJsonFile, "Contracts file is required for price publisher");
        const contracts = loadContracts(runConfig.contractsJsonFile);
        const publisherApiKeys = dataAccessLayerApiKey(secrets, runConfig.dataAccessLayerUrls);
        const maxDelayMs = runConfig.pricePublisherConfig.loopDelayMs ?? DEFAULT_PRICE_PUBLISHER_LOOP_DELAY_MS;
        const ftsoV2PriceStore = await FtsoV2PriceStore.at(contracts.FtsoV2PriceStore.address);
        const pricePublisherService = new PricePublisherService(ftsoV2PriceStore, pricePublisherAddress, runConfig.dataAccessLayerUrls, publisherApiKeys, maxDelayMs);
        return pricePublisherService;
    }

    start() {
        this.running = true;
        void loggerAsyncStorage.run("price-publisher", () => this.run());
    }

    requestStop() {
        this.running = false;
    }

    async stop() {
        this.requestStop();
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
                    // wait a small random time to avoid many reverts because all agents publish at the same time
                    const randomWaitMS = Math.floor(Math.random() * PRICE_PUBLISHING_TIME_RANDOMIZATION_MS);
                    await sleep(randomWaitMS);
                    await this.getAndPublishFeedData(lastAvailableRoundId);
                }
            } catch (error) {
                if (errorIncluded(error, ["prices already published"])) {
                    logger.info("Reverted with: prices already published")
                } else {
                    logger.error(`Error in publishing prices: ${error}`);
                }
            }
            await sleep(this.loopDelayMs);
        }
        this.stopped = true;
        logger.info(`Price publishing service stopped.`);
        console.log(`Price publishing service stopped.`);
    }

    async getLastAvailableRoundId() {
        let lastRoundId = -1;
        for (const [index, url] of this.priceFeedApiUrls.entries()) {
            try {
                const response = await axios.get<FspStatusResult>(`${url}/api/v0/fsp/status`, {
                    headers: {
                        'x-apikey': this.apiKeys[index]
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
        for (const [index, url] of this.priceFeedApiUrls.entries()) {
            try {
                const feeds = await this.getFeedDataForUrl(url, this.apiKeys[index], votingRoundId, feedIds);
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

    private async getFeedDataForUrl(url: string, apiKey: string, votingRoundId: number, feedIds: string[]): Promise<FtsoFeedResultWithProof[] | null> {
        const response = await axios.post(`${url}/api/v0/ftso/anchor-feeds-with-proof?voting_round_id=${votingRoundId}`, {
            feed_ids: feedIds
        }, {
            headers: {
                'x-apikey': apiKey
            }
        });
        // get data
        const feedsData: FtsoFeedResultWithProof[] = response.data;
        // check that voting round is correct
        if (feedsData.some(fd => Number(fd.body.votingRoundId) !== votingRoundId)) {
            return null;
        }
        // sort nodes by order of feedIds array
        feedsData.sort((a, b) => feedIds.indexOf(a.body.id) - feedIds.indexOf(b.body.id));
        return feedsData;
    }

    async getAndPublishFeedData(votingRoundId: number) {
        const sleepTime = Math.floor(Math.random() * 2000); // wait small random time, so that there are fewer reverts due to already published prices
        await sleep(sleepTime);
        logger.info(`Publishing prices for ${votingRoundId}`);
        const feedIds = await this.ftsoV2PriceStore.getFeedIds();
        const feedsData = await this.getFeedData(votingRoundId, feedIds);
        if (feedsData != null) {
            const lastPublishedRoundId = Number(await this.ftsoV2PriceStore.lastPublishedVotingRoundId());
            if (votingRoundId > lastPublishedRoundId) {
                const ftsoV2PriceStore = withSettings(this.ftsoV2PriceStore, {
                    // It is really important that at least one bot submits prices soon after they are proved,
                    // so force a very large price factor if the submission isn't mined immediately.
                    resubmitTransaction: [
                        { afterMS: 5000, priceFactor: 2.0 },
                        { afterMS: 15000, priceFactor: 5.0 },
                    ]
                });
                await ftsoV2PriceStore.publishPrices(feedsData, { from: this.publisherAddress });
                logger.info(`Prices published for round ${votingRoundId}`);
            } else {
                logger.info(`Prices for round ${votingRoundId} already published`);
            }
        } else {
            logger.info(`No new price data available`);
        }
    }
}
