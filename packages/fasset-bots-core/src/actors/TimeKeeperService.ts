import { KeeperBotConfig, createTimekeeperContext } from "../config";
import { ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { ChainId } from "../underlying-chain/SourceId";
import { requireNotNull } from "../utils";
import { TimeKeeper, TimeKeeperQueryWindow } from "./TimeKeeper";

export class TimeKeeperService {
    static deepCopyWithObjectCreate = true;

    constructor(
        public contexts: Map<ChainId, ITimekeeperContext>,
        public timekeeperAddress: string,
        public queryWindow: TimeKeeperQueryWindow,
        public updateIntervalMs: number,
        public loopDelayMs: number
    ) {}

    timekeepers = new Map<ChainId, TimeKeeper>();

    static async create(config: KeeperBotConfig, timekeeperAddress: string, queryWindow: TimeKeeperQueryWindow, updateIntervalMs: number, loopDelayMs: number) {
        const contexts: Map<ChainId, ITimekeeperContext> = new Map();
        for (const chain of config.fAssets.values()) {
            const chainId = chain.chainInfo.chainId;
            if (!contexts.has(chainId)) {
                const context = await createTimekeeperContext(config, chain);
                contexts.set(chainId, context);
            }
        }
        return new TimeKeeperService(contexts, timekeeperAddress, queryWindow, updateIntervalMs, loopDelayMs);
    }

    get(chainId: ChainId) {
        const timekeeper = this.timekeepers.get(chainId);
        if (timekeeper != null) return timekeeper;
        return this.start(chainId);
    }

    start(chainId: ChainId) {
        const context = requireNotNull(this.contexts.get(chainId), `Unknown chain id ${chainId}`);
        const timekeeper = new TimeKeeper(context, this.timekeeperAddress, this.queryWindow, this.updateIntervalMs, this.loopDelayMs);
        this.timekeepers.set(chainId, timekeeper);
        timekeeper.run();
        return timekeeper;
    }

    startAll() {
        for (const chainId of this.contexts.keys()) {
            this.start(chainId);
        }
    }

    async stopAll() {
        for (const timekeeper of this.timekeepers.values()) {
            timekeeper.stop();
        }
        for (const timekeeper of this.timekeepers.values()) {
            await timekeeper.waitStop();
        }
    }
}
