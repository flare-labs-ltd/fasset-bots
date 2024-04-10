import { AgentDestroyed } from "../../typechain-truffle/IIAssetManager";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { AgentStatus, AssetManagerSettings, CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { LiquidationStrategyImplSettings } from "../fasset/LiquidationStrategyImpl";
import { Web3ContractEventDecoder } from "../utils/events/Web3ContractEventDecoder";
import { EventArgs, EvmEvent, eventOrder } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
import { BN_ZERO, sleep, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { web3 } from "../utils/web3";
import { web3DeepNormalize, web3Normalize } from "../utils/web3normalize";
import { CollateralList, isPoolCollateral } from "./CollateralIndexedList";
import { Prices } from "./Prices";
import { tokenContract } from "./TokenPrice";
import { InitialAgentData, TrackedAgentState } from "./TrackedAgentState";

export const MAX_EVENT_HANDLE_RETRY = 10;
export const SLEEP_MS_BEFORE_RETRY = 1000;

export class TrackedState {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetNativeChainContext,
        private currentEventBlock: number
    ) {}

    // state
    fAssetSupply = BN_ZERO;

    // must call initialize to init prices and settings
    prices!: Prices;
    trustedPrices!: Prices;

    // settings
    settings!: AssetManagerSettings;
    liquidationStrategySettings!: LiquidationStrategyImplSettings;
    collaterals = new CollateralList();
    poolWNatCollateral!: CollateralType;

    // tracked agents
    agents: Map<string, TrackedAgentState> = new Map(); // map agent_address => tracked agent state
    agentsByUnderlying: Map<string, TrackedAgentState> = new Map(); // map underlying_address => tracked agent state
    agentsByPool: Map<string, TrackedAgentState> = new Map(); // map pool_address => tracked agent state

    // event decoder
    eventDecoder = new Web3ContractEventDecoder({ priceChangeEmitter: this.context.priceChangeEmitter, assetManager: this.context.assetManager });

    /**
     * Create and initialize TrackedState
     */
    static async create(context: IAssetNativeChainContext, currentEventBlock: number) {
        const trackedState = new TrackedState(context, currentEventBlock);
        await trackedState.initialize();
        return trackedState;
    }

    // async initialization part
    async initialize(): Promise<void> {
        // reset state if initialize was used for reinitialization
        this.agents = new Map();
        this.agentsByUnderlying = new Map();
        this.agentsByPool = new Map();
        // initialize
        logger.info(`Tracked State is started to initialize.`);
        // settings
        this.settings = Object.assign({}, await this.context.assetManager.getSettings());
        logger.info(`Tracked State set settings ${formatArgs(this.settings)}`);
        // collateral tokens
        const collateralTokens = await this.context.assetManager.getCollateralTypes();
        for (const collateralToken of collateralTokens) {
            const collateral = await this.addCollateralType(collateralToken);
            // poolCollateral will be the last active collateral of class pool
            if (isPoolCollateral(collateral)) {
                this.poolWNatCollateral = collateral;
            }
        }
        // fAsset supply
        this.fAssetSupply = await this.context.fAsset.totalSupply();
        logger.info(`Tracked State set fAssetSupply ${this.fAssetSupply.toString()}`);
        // prices
        [this.prices, this.trustedPrices] = await this.getPrices();
        logger.info(`Tracked State is successfully initialized.`);
    }

    async getPrices(): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.settings, this.collaterals);
    }

    async registerStateEvents(events: EvmEvent[]): Promise<void> {
        let retries = 0;
        for (let i = 0; i < events.length; i++) {
            try {
                await this.registerStateEvent(events[i]);
                retries = 0;
            } catch (error) {
                if (retries > MAX_EVENT_HANDLE_RETRY) {
                    this.currentEventBlock = await web3.eth.getBlockNumber();
                    await this.initialize();
                    break;
                } else {
                    i -= 1;
                    retries += 1;
                    console.error(`Error handling events for Tracked State: ${error}`);
                    logger.error(`Tracked State run into error while handling events:`, error);
                    await sleep(SLEEP_MS_BEFORE_RETRY);
                }
            }
        }
    }

    async registerStateEvent(event: EvmEvent): Promise<void> {
        if (eventIs(event, this.context.priceChangeEmitter, "PriceEpochFinalized")) {
            logger.info(`Tracked State received event 'PriceEpochFinalized' with data ${formatArgs(event.args)}.`);
            [this.prices, this.trustedPrices] = await this.getPrices();
        } else if (eventIs(event, this.context.assetManager, "SettingChanged")) {
            logger.info(`Tracked State received event 'SettingChanged' with data ${formatArgs(event.args)}.`);
            if (event.args.name === "liquidationStepSeconds") {
                (this.liquidationStrategySettings as any)[event.args.name] = web3Normalize(event.args.value);
                logger.info(`Tracked State set liquidationStrategySettings ${formatArgs(this.liquidationStrategySettings)}.`);
            } else if (!(event.args.name in this.settings)) {
                throw new Error(`Invalid setting change ${event.args.name}`);
            } else {
                (this.settings as any)[event.args.name] = web3Normalize(event.args.value);
                logger.info(`Tracked State set settings ${formatArgs(this.settings)}.`);
            }
        } else if (eventIs(event, this.context.assetManager, "SettingArrayChanged")) {
            logger.info(`Tracked State received event 'SettingArrayChanged' with data ${formatArgs(event.args)}.`);
            if (!(event.args.name in this.liquidationStrategySettings)) throw new Error(`Invalid setting array change ${event.args.name}`);
            (this.liquidationStrategySettings as any)[event.args.name] = web3DeepNormalize(event.args.value);
            logger.info(`Tracked State set liquidationStrategySettings ${formatArgs(this.liquidationStrategySettings)}.`);
        } else if (eventIs(event, this.context.assetManager, "AgentSettingChanged")) {
            logger.info(`Tracked State received event 'AgentSettingChanged' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleAgentSettingChanged(event.args.name, event.args.value);
        } else if (eventIs(event, this.context.assetManager, "MintingExecuted")) {
            logger.info(`Tracked State received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
            this.fAssetSupply = this.fAssetSupply.add(toBN(event.args.mintedAmountUBA).add(toBN(event.args.poolFeeUBA)));
            logger.info(`Tracked State set fAssetSupply ${this.fAssetSupply.toString()}`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleMintingExecuted(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionRequested")) {
            logger.info(`Tracked State received event 'RedemptionRequested' with data ${formatArgs(event.args)}.`);
            this.fAssetSupply = this.fAssetSupply.sub(toBN(event.args.valueUBA));
            logger.info(`Tracked State set fAssetSupply ${this.fAssetSupply.toString()}`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionRequested(event.args);
        } else if (eventIs(event, this.context.assetManager, "SelfClose")) {
            logger.info(`Tracked State received event 'SelfClose' with data ${formatArgs(event.args)}.`);
            this.fAssetSupply = this.fAssetSupply.sub(toBN(event.args.valueUBA));
            logger.info(`Tracked State set fAssetSupply ${this.fAssetSupply.toString()}`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleSelfClose(event.args);
        } else if (eventIs(event, this.context.assetManager, "LiquidationPerformed")) {
            logger.info(`Tracked State received event 'LiquidationPerformed' with data ${formatArgs(event.args)}.`);
            this.fAssetSupply = this.fAssetSupply.sub(toBN(event.args.valueUBA));
            logger.info(`Tracked State set fAssetSupply ${this.fAssetSupply.toString()}`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleLiquidationPerformed(event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralTypeAdded")) {
            logger.info(`Tracked State received event 'CollateralTypeAdded' with data ${formatArgs(event.args)}.`);
            void this.addCollateralType({ ...event.args, validUntil: BN_ZERO });
        } else if (eventIs(event, this.context.assetManager, "CollateralRatiosChanged")) {
            logger.info(`Tracked State received event 'CollateralRatiosChanged' with data ${formatArgs(event.args)}.`);
            const collateral = this.collaterals.get(event.args.collateralClass, event.args.collateralToken);
            collateral.minCollateralRatioBIPS = toBN(event.args.minCollateralRatioBIPS);
            collateral.ccbMinCollateralRatioBIPS = toBN(event.args.ccbMinCollateralRatioBIPS);
            collateral.safetyMinCollateralRatioBIPS = toBN(event.args.safetyMinCollateralRatioBIPS);
        } else if (eventIs(event, this.context.assetManager, "CollateralTypeDeprecated")) {
            logger.info(`Tracked State received event 'CollateralTypeDeprecated' with data ${formatArgs(event.args)}.`);
            const collateral = this.collaterals.get(event.args.collateralClass, event.args.collateralToken);
            collateral.validUntil = toBN(event.args.validUntil);
        } else if (eventIs(event, this.context.assetManager, "AgentCollateralTypeChanged")) {
            logger.info(`Tracked State received event 'AgentCollateralTypeChanged' with data ${formatArgs(event.args)}.`);
            if (event.args.collateralClass.toNumber() === CollateralClass.VAULT) {
                (await this.getAgentTriggerAdd(event.args.agentVault)).handleAgentCollateralTypeChanged(event.args);
            }
        } else if (eventIs(event, this.context.assetManager, "AgentVaultCreated")) {
            logger.info(`Tracked State received event 'AgentVaultCreated' with data ${formatArgs(event.args)}.`);
            this.createAgent(event.args);
        } else if (eventIs(event, this.context.assetManager, "AgentDestroyed")) {
            logger.info(`Tracked State received event 'AgentDestroyed' with data ${formatArgs(event.args)}.`);
            this.destroyAgent(event.args);
        } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
            logger.info(`Tracked State received event 'AgentInCCB' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.CCB, event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "LiquidationStarted")) {
            logger.info(`Tracked State received event 'LiquidationStarted' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.LIQUIDATION, event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "FullLiquidationStarted")) {
            logger.info(`Tracked State received event 'FullLiquidationStarted' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.FULL_LIQUIDATION, event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "LiquidationEnded")) {
            logger.info(`Tracked State received event 'LiquidationEnded' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.NORMAL);
        } else if (eventIs(event, this.context.assetManager, "AgentDestroyAnnounced")) {
            logger.info(`Tracked State received event 'AgentDestroyAnnounced' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.DESTROYING, event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "AgentAvailable")) {
            logger.info(`Tracked State received event 'AgentAvailable' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleAgentAvailable(event.args);
        } else if (eventIs(event, this.context.assetManager, "AvailableAgentExited")) {
            logger.info(`Tracked State received event 'AvailableAgentExited' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleAvailableAgentExited();
        } else if (eventIs(event, this.context.assetManager, "CollateralReserved")) {
            logger.info(`Tracked State received event 'CollateralReserved' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleCollateralReserved(event.args);
        } else if (eventIs(event, this.context.assetManager, "MintingPaymentDefault")) {
            logger.info(`Tracked State received event 'MintingPaymentDefault' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleMintingPaymentDefault(event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReservationDeleted")) {
            logger.info(`Tracked State received event 'CollateralReservationDeleted' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleCollateralReservationDeleted(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPerformed")) {
            logger.info(`Tracked State received event 'RedemptionPerformed' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionPerformed(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionDefault")) {
            logger.info(`Tracked State received event 'RedemptionDefault' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionDefault(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentBlocked")) {
            logger.info(`Tracked State received event 'RedemptionPaymentBlocked' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionPaymentBlocked(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentFailed")) {
            logger.info(`Tracked State received event 'RedemptionPaymentFailed' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionPaymentFailed(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedeemedInCollateral")) {
            logger.info(`Tracked State received event 'RedeemedInCollateral' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedeemedInCollateral(event.args);
        } else if (eventIs(event, this.context.assetManager, "UnderlyingBalanceToppedUp")) {
            logger.info(`Tracked State received event 'UnderlyingBalanceToppedUp' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingBalanceToppedUp(event.args);
        } else if (eventIs(event, this.context.assetManager, "UnderlyingWithdrawalAnnounced")) {
            logger.info(`Tracked State received event 'UnderlyingWithdrawalAnnounced' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingWithdrawalAnnounced(event.args);
        } else if (eventIs(event, this.context.assetManager, "UnderlyingWithdrawalConfirmed")) {
            logger.info(`Tracked State received event 'UnderlyingWithdrawalConfirmed' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingWithdrawalConfirmed(event.args);
        } else if (eventIs(event, this.context.assetManager, "UnderlyingWithdrawalCancelled")) {
            logger.info(`Tracked State received event 'UnderlyingWithdrawalCancelled' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingWithdrawalCancelled();
        } else if (eventIs(event, this.context.assetManager, "DustChanged")) {
            logger.info(`Tracked State received event 'DustChanged' with data ${formatArgs(event.args)}.`);
            (await this.getAgentTriggerAdd(event.args.agentVault)).handleDustChanged(event.args);
        }
        for (const collateral of this.collaterals.list) {
            const contract = await tokenContract(collateral.token);
            if (eventIs(event, contract, "Transfer")) {
                logger.info(`Tracked State received event 'Transfer' with data ${formatArgs(event.args)}.`);
                this.agents.get(event.args.from)?.withdrawVaultCollateral(contract.address, toBN(event.args.value));
                this.agents.get(event.args.to)?.depositVaultCollateral(contract.address, toBN(event.args.value));
                this.agentsByPool.get(event.args.from)?.withdrawPoolCollateral(toBN(event.args.value));
                this.agentsByPool.get(event.args.to)?.depositPoolCollateral(toBN(event.args.value));
            }
        }
    }

    async readUnhandledEvents(): Promise<EvmEvent[]> {
        logger.info(`Tracked State started reading native events FROM block ${this.currentEventBlock}.`);
        // get all needed logs for state
        const nci = this.context.nativeChainInfo;
        const lastBlock = (await web3.eth.getBlockNumber()) - nci.finalizationBlocks;
        const events: EvmEvent[] = [];
        for (let lastHandled = this.currentEventBlock; lastHandled <= lastBlock; lastHandled += nci.readLogsChunkSize) {
            // handle collaterals
            for (const collateral of this.collaterals.list) {
                const contract = await tokenContract(collateral.token);
                const logsCollateral = await web3.eth.getPastLogs({
                    address: contract.address,
                    fromBlock: lastHandled,
                    toBlock: Math.min(lastHandled + nci.readLogsChunkSize - 1, lastBlock),
                    topics: [null],
                });
                const eventDecoderCollaterals = new Web3ContractEventDecoder({ collateralDecode: contract });
                events.push(...eventDecoderCollaterals.decodeEvents(logsCollateral));
            }
            // handle asset manager
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastHandled,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null],
            });
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
            // handle ftso manager
            const logsFtsoManager = await web3.eth.getPastLogs({
                address: this.context.priceChangeEmitter.address,
                fromBlock: lastHandled,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null],
            });
            events.push(...this.eventDecoder.decodeEvents(logsFtsoManager));
        }
        // mark as handled
        this.currentEventBlock = lastBlock + 1;
        // run state events
        events.sort(eventOrder);
        logger.info(`Tracked State finished reading native events TO block ${lastBlock}.`);
        await this.registerStateEvents(events);
        return events;
    }

    private async addCollateralType(data: CollateralType) {
        const collateral: CollateralType = {
            collateralClass: toBN(data.collateralClass),
            token: data.token,
            decimals: toBN(data.decimals),
            validUntil: data.validUntil,
            directPricePair: data.directPricePair,
            assetFtsoSymbol: data.assetFtsoSymbol,
            tokenFtsoSymbol: data.tokenFtsoSymbol,
            minCollateralRatioBIPS: toBN(data.minCollateralRatioBIPS),
            ccbMinCollateralRatioBIPS: toBN(data.ccbMinCollateralRatioBIPS),
            safetyMinCollateralRatioBIPS: toBN(data.safetyMinCollateralRatioBIPS),
        };
        this.collaterals.add(collateral);
        logger.info(`Tracked State added collateral ${formatArgs(collateral)}.`);
        return collateral;
    }

    async createAgentWithCurrentState(vaultAddress: string): Promise<TrackedAgentState> {
        const agentInfo = await this.context.assetManager.getAgentInfo(vaultAddress);
        const agent = this.createAgent({
            agentVault: vaultAddress,
            owner: agentInfo.ownerManagementAddress,
            underlyingAddress: agentInfo.underlyingAddressString,
            collateralPool: agentInfo.collateralPool,
            vaultCollateralToken: agentInfo.vaultCollateralToken,
            feeBIPS: agentInfo.feeBIPS,
            poolFeeShareBIPS: agentInfo.poolFeeShareBIPS,
            mintingVaultCollateralRatioBIPS: agentInfo.mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: agentInfo.mintingPoolCollateralRatioBIPS,
            buyFAssetByAgentFactorBIPS: agentInfo.buyFAssetByAgentFactorBIPS,
            poolExitCollateralRatioBIPS: agentInfo.poolExitCollateralRatioBIPS,
            poolTopupCollateralRatioBIPS: agentInfo.poolTopupCollateralRatioBIPS,
            poolTopupTokenPriceFactorBIPS: agentInfo.poolTopupTokenPriceFactorBIPS,
        });
        agent.initialize(agentInfo);
        return agent;
    }

    createAgent(data: InitialAgentData): TrackedAgentState {
        const agent = this.newAgent(data);
        this.agents.set(agent.vaultAddress, agent);
        this.agentsByUnderlying.set(agent.underlyingAddress, agent);
        this.agentsByPool.set(agent.collateralPoolAddress, agent);
        logger.info(`Tracked State added agent ${formatArgs(data)}.`);
        return agent;
    }

    protected newAgent(data: InitialAgentData): TrackedAgentState {
        return new TrackedAgentState(this, data);
    }

    destroyAgent(args: EventArgs<AgentDestroyed>): void {
        const agent = this.getAgent(args.agentVault);
        if (agent) {
            this.agents.delete(args.agentVault);
            this.agentsByUnderlying.delete(agent.underlyingAddress);
            this.agentsByPool.delete(agent.collateralPoolAddress);
            logger.info(`Tracked State deleted agent ${formatArgs(args)}.`);
        }
    }

    getAgent(vaultAddress: string): TrackedAgentState | undefined {
        return this.agents.get(vaultAddress);
    }

    async getAgentTriggerAdd(vaultAddress: string): Promise<TrackedAgentState> {
        const agent = this.agents.get(vaultAddress);
        if (!agent) {
            return await this.createAgentWithCurrentState(vaultAddress);
        }
        return agent;
    }
}
