import { KeeperBotConfig, createTimekeeperContext } from "../config";
import { ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { requireNotNull } from "../utils";
import { TimeKeeper, TimekeeperTimingConfig } from "./TimeKeeper";

export class TimeKeeperService {
    static deepCopyWithObjectCreate = true;

    constructor(
        public contexts: Map<string, ITimekeeperContext>,   // map [chain token symbol] => context
        public timekeeperAddress: string,
        public timing: TimekeeperTimingConfig,
    ) {}

    timekeepers = new Map<string, TimeKeeper>();

    static async create(config: KeeperBotConfig, timekeeperAddress: string, timing: TimekeeperTimingConfig) {
        const contexts: Map<string, ITimekeeperContext> = new Map();
        for (const chain of config.fAssets.values()) {
            const symbol = chain.fAssetSymbol;
            if (!contexts.has(symbol)) {
                const context = await createTimekeeperContext(config, chain);
                contexts.set(symbol, context);
            }
        }
        return new TimeKeeperService(contexts, timekeeperAddress, timing);
    }

    get(symbol: string) {
        const timekeeper = this.timekeepers.get(symbol);
        if (timekeeper != null) return timekeeper;
        return this.start(symbol);
    }

    start(symbol: string) {
        const context = requireNotNull(this.contexts.get(symbol), `Unknown chain token symbol ${symbol}`);
        const timekeeper = new TimeKeeper(context, this.timekeeperAddress, this.timing);
        this.timekeepers.set(symbol, timekeeper);
        timekeeper.run();
        return timekeeper;
    }

    startAll() {
        for (const fassetSymbol of this.contexts.keys()) {
            this.start(fassetSymbol);
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
