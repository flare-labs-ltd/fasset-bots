import { CreateRequestContext } from "@mikro-orm/core";
import { AgentBotConfig, AgentBotSettings, Secrets } from "../config";
import { createAgentBotContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { squashSpace, web3 } from "../utils";
import { firstValue, getOrCreate, requireNotNull, sleep } from "../utils/helpers";
import { logger } from "../utils/logger";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { AgentBot, AgentBotLocks, AgentBotTransientStorage, ITimeKeeper } from "./AgentBot";

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

    public stopRequested = false;
    public restartRequested = false;
    public running = false;

    public runningAgentBots = new Map<string, AgentBot>();

    public locks = new AgentBotLocks();

    private transientStorage: Map<string, AgentBotTransientStorage> = new Map();

    @CreateRequestContext()
    async run(): Promise<void> {
        this.stopRequested = false;
        this.restartRequested = false;
        this.running = true;
        try {
            while (!this.readyToStop()) {
                await this.runStep();
            }
        } finally {
            this.running = false;
        }
    }

    parallel() {
        // paralle has same value for all chains, so just use first
        return firstValue(this.settings)?.parallel ?? false;
    }

    readyToStop() {
        return this.stopOrRestartRequested() && this.runningAgentBots.size === 0;
    }

    stopOrRestartRequested(): boolean {
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
     */
    async runStep() {
        try {
            if (this.parallel()) {
                await this.runStepParallel();
            } else {
                await this.runStepSerial();
            }
        } catch (error) {
            logger.error(`Error running step of agent bot runner:`, error);
        }
    }

    /**
     * This is the main method, for parallel mode.
     * In every step it updates the list of running agents and runs new ones if they were added to the database.
     */
    async runStepParallel(): Promise<void> {
        this.removeStoppedAgentBots();
        if (!this.stopOrRestartRequested()) {
            this.checkForWorkAddressChange();
            await this.addNewAgentBots();
        }
        const sleepMS = this.stopOrRestartRequested() ? this.loopDelay : 100;
        await sleep(sleepMS);
    }

    /**
     * This is the main method, for serial mode (tests with sqlite).
     * In every step it collects all active agent entities and for every one it construct AgentBot and runs its runsStep method, which handles required events and other methods.
     */
    async runStepSerial(): Promise<void> {
        const agentEntities = await this.orm.em.find(AgentEntity, { active: true });
        for (const agentEntity of agentEntities) {
            this.checkForWorkAddressChange();
            if (this.stopOrRestartRequested()) break;
            try {
                const agentBot = await this.newAgentBot(agentEntity);
                if (agentBot == null) continue;
                logger.info(`Owner's ${agentEntity.ownerAddress} AgentBotRunner started handling agent ${agentBot.agent.vaultAddress}.`);
                await agentBot.runStep(this.orm.em);
                logger.info(`Owner's ${agentEntity.ownerAddress} AgentBotRunner finished handling agent ${agentBot.agent.vaultAddress}.`);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}: ${error}`);
                logger.error(`Owner's ${agentEntity.ownerAddress} AgentBotRunner ran into error with agent ${agentEntity.vaultAddress}:`, error);
            }
        }
    }

    async addNewAgentBots() {
        const agentEntities = await this.orm.em.find(AgentEntity, { active: true });
        for (const agentEntity of agentEntities) {
            if (this.runningAgentBots.has(agentEntity.vaultAddress)) continue;
            // create new bot
            try {
                const agentBot = await this.newAgentBot(agentEntity);
                if (agentBot == null) continue;
                void agentBot.runThreads(this.orm.em).catch((error) => {
                    logger.error(`Agent bot ${agentBot.agent?.vaultAddress} thread ended unxpectedly:`, error);
                    console.error(`Agent bot ${agentBot.agent?.vaultAddress} thread ended unxpectedly:`, error);
                });
                this.runningAgentBots.set(agentEntity.vaultAddress, agentBot);
                logger.info(`Owner's ${agentEntity.ownerAddress} AgentBotRunner added running agent ${agentBot.agent.vaultAddress}.`);
            } catch (error) {
                console.error(`Error with adding running agent ${agentEntity.vaultAddress}: ${error}`);
                logger.error(`Owner's ${agentEntity.ownerAddress} AgentBotRunner ran into error starting agent ${agentEntity.vaultAddress}:`, error);
            }
        }
    }

    async newAgentBot(agentEntity: AgentEntity) {
        const context = this.contexts.get(agentEntity.fassetSymbol);
        if (context == null) {
            console.warn(`Invalid fasset symbol ${agentEntity.fassetSymbol}`);
            logger.warn(`Owner's ${agentEntity.ownerAddress} AgentBotRunner found invalid token symbol ${agentEntity.fassetSymbol}.`);
            return null;
        }
        const agentBotSettings = requireNotNull(this.settings.get(agentEntity.fassetSymbol));    // cannot be missing - see create()
        const ownerUnderlyingAddress = AgentBot.underlyingAddress(this.secrets, context.chainInfo.chainId);
        const agentBot = await AgentBot.fromEntity(context, agentBotSettings, agentEntity, ownerUnderlyingAddress, this.notifierTransports);
        agentBot.runner = this;
        agentBot.timekeeper = this.timekeeperService.get(agentEntity.fassetSymbol);
        agentBot.transientStorage = getOrCreate(this.transientStorage, agentBot.agent.vaultAddress, () => new AgentBotTransientStorage());
        agentBot.locks = this.locks;
        agentBot.loopDelay = this.loopDelay;
        return agentBot;
    }

    removeStoppedAgentBots() {
        const agentBotEntries = Array.from(this.runningAgentBots.entries());
        for (const [address, agentBot] of agentBotEntries) {
            if (!agentBot.running()) {
                this.runningAgentBots.delete(address);
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
            logger.info(squashSpace`Owner's ${ownerAddress} AgentBotRunner set context for fasset token ${chainConfig.fAssetSymbol}
                on chain ${assetContext.chainInfo.chainId} with asset manager ${assetContext.assetManager.address}`);
        }
        logger.info(`Owner ${ownerAddress} created AgentBotRunner.`);
        return new AgentBotRunner(secrets, contexts, settings, botConfig.orm, botConfig.loopDelay, botConfig.notifiers, timekeeperService);
    }
}
