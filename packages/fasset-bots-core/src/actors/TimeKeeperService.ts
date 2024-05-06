import { KeeperBotConfig, createTimekeeperContext } from "../config";
import { ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { requireNotNull } from "../utils";
import { TimeKeeper, TimeKeeperQueryWindow } from "./TimeKeeper";

export class TimeKeeperService {
    static deepCopyWithObjectCreate = true;

    constructor(
        public contexts: Map<string, ITimekeeperContext>,   // map [chain token symbol] => context
        public timekeeperAddress: string,
        public queryWindow: TimeKeeperQueryWindow,
        public updateIntervalMs: number,
        public loopDelayMs: number
    ) {}

    timekeepers = new Map<string, TimeKeeper>();

    static async create(config: KeeperBotConfig, timekeeperAddress: string, queryWindow: TimeKeeperQueryWindow, updateIntervalMs: number, loopDelayMs: number) {
        const contexts: Map<string, ITimekeeperContext> = new Map();
        for (const chain of config.fAssets.values()) {
            const symbol = chain.chainInfo.symbol;
            if (!contexts.has(symbol)) {
                const context = await createTimekeeperContext(config, chain);
                contexts.set(symbol, context);
            }
        }
        return new TimeKeeperService(contexts, timekeeperAddress, queryWindow, updateIntervalMs, loopDelayMs);
    }

    get(symbol: string) {
        const timekeeper = this.timekeepers.get(symbol);
        if (timekeeper != null) return timekeeper;
        return this.start(symbol);
    }

    start(symbol: string) {
        const context = requireNotNull(this.contexts.get(symbol), `Unknown chain token symbol ${symbol}`);
        const timekeeper = new TimeKeeper(context, this.timekeeperAddress, this.queryWindow, this.updateIntervalMs, this.loopDelayMs);
        this.timekeepers.set(symbol, timekeeper);
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
