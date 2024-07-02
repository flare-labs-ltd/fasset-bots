import { CreateRequestContext, FilterQuery } from "@mikro-orm/core";
import { AgentBotConfig, AgentBotSettings, Secrets } from "../config";
import { createAgentBotContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { web3 } from "../utils";
import { getOrCreate, requireNotNull, sleep } from "../utils/helpers";
import { logger } from "../utils/logger";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { AgentBot, AgentBotTransientStorage, ITimeKeeper } from "./AgentBot";

export interface ITimeKeeperService {
    get(symbol: string): ITimeKeeper;
}

export class AgentBotRunner {
    static deepCopyWithObjectCreate = true;

    constructor(
        public secrets: Secrets,
        public contexts: Map<string, IAssetAgentContext>,   // map [fasset symbol] => context
        public settings: Map<string, AgentBotSettings>,
        public orm: ORM,
        public loopDelay: number,
        public notifierTransports: NotifierTransport[],
        public timekeeperService: ITimeKeeperService,
    ) {}

    public running = false;
    public stopRequested = false;
    public restartRequested = false;

    private transientStorage: Map<string, AgentBotTransientStorage> = new Map();

    async run(): Promise<void> {
        this.stopRequested = false;
        this.restartRequested = false;
        this.running = true;
        try {
            while (!this.stopLoop()) {
                await this.runStep();
                if (this.stopLoop()) break;
            }
        } finally {
            this.running = false;
        }
    }

    stopLoop(): boolean {
        return this.stopRequested || this.restartRequested;
    }

    requestStop(): void {
        this.stopRequested = true;
    }

    requestRestart(): void {
        this.restartRequested = true;
    }

    /**
     * This is the main method, where "automatic" logic is gathered.
     * In every step it firstly collects all active agent entities. For every entity it construct AgentBot and runs its runsStep method,
     * which handles required events and other.
     */
    @CreateRequestContext()
    async runStep(): Promise<void> {
        const agentEntities = await this.orm.em.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        for (const agentEntity of agentEntities) {
            this.checkForWorkAddressChange();
            if (this.stopLoop()) break;
            try {
                const context = this.contexts.get(agentEntity.fassetSymbol);
                if (context == null) {
                    console.warn(`Invalid fasset symbol ${agentEntity.fassetSymbol}`);
                    logger.warn(`Owner's ${agentEntity.ownerAddress} AgentBotRunner found invalid token symbol ${agentEntity.fassetSymbol}.`);
                    continue;
                }
                const agentBotSettings = requireNotNull(this.settings.get(agentEntity.fassetSymbol));    // cannot be missing - see create()
                const ownerUnderlyingAddress = AgentBot.underlyingAddress(this.secrets, context.chainInfo.chainId);
                const agentBot = await AgentBot.fromEntity(context, agentBotSettings, agentEntity, ownerUnderlyingAddress, this.notifierTransports);
                agentBot.runner = this;
                agentBot.timekeeper = this.timekeeperService.get(agentEntity.fassetSymbol);
                agentBot.transientStorage = getOrCreate(this.transientStorage, agentBot.agent.vaultAddress, () => new AgentBotTransientStorage());
                logger.info(`Owner's ${agentEntity.ownerAddress} AgentBotRunner started handling agent ${agentBot.agent.vaultAddress}.`);
                await agentBot.runStep(this.orm.em);
                logger.info(`Owner's ${agentEntity.ownerAddress} AgentBotRunner finished handling agent ${agentBot.agent.vaultAddress}.`);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}: ${error}`);
                logger.error(`Owner's ${agentEntity.ownerAddress} AgentBotRunner ran into error with agent ${agentEntity.vaultAddress}:`, error);
            }
        }
    }

    checkForWorkAddressChange() {
        if (this.secrets.filePath === "MEMORY") return;     // memory secrets (for tests)
        const newSecrets = Secrets.load(this.secrets.filePath);
        if (web3.eth.defaultAccount !== newSecrets.required(`owner.native.address`)) {
            const ownerAddress = newSecrets.required(`owner.native.address`);
            this.requestRestart();
            console.warn(`Owner's native address from secrets file, does not match their used account`);
            logger.warn(`Owner's native address ${ownerAddress} from secrets file, does not match web3 default account ${web3.eth.defaultAccount}`);
        }
    }

    /**
     * Creates AgentBot runner from AgentBotConfig
     * @param botConfig - configs to run bot
     * @returns instance of AgentBotRunner
     */
    static async create(secrets: Secrets, botConfig: AgentBotConfig, timekeeperService: ITimeKeeperService): Promise<AgentBotRunner> {
        const ownerAddress = secrets.required("owner.management.address");
        logger.info(`Owner ${ownerAddress} started to create AgentBotRunner.`);
        const contexts: Map<string, IAssetAgentContext> = new Map();
        const settings: Map<string, AgentBotSettings> = new Map();
        for (const chainConfig of botConfig.fAssets.values()) {
            const assetContext = await createAgentBotContext(botConfig, chainConfig);
            contexts.set(chainConfig.fAssetSymbol, assetContext);
            settings.set(chainConfig.fAssetSymbol, chainConfig.agentBotSettings);
            logger.info(`Owner's ${ownerAddress} AgentBotRunner set context for fasset token ${chainConfig.fAssetSymbol} on chain ${assetContext.chainInfo.chainId}`);
        }
        logger.info(`Owner ${ownerAddress} created AgentBotRunner.`);
        return new AgentBotRunner(secrets, contexts, settings, botConfig.orm, botConfig.loopDelay, botConfig.notifiers, timekeeperService);
    }
}
