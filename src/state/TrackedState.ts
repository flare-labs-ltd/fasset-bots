import { EventArgs, EvmEvent } from "../utils/events/common";
import { AgentDestroyed } from "../../typechain-truffle/AssetManager";
import { InitialAgentData, TrackedAgentState } from "./TrackedAgentState";
import { IAssetTrackedStateContext } from "../fasset-bots/IAssetBotContext";
import { AgentStatus, AssetManagerSettings, CollateralType } from "../fasset/AssetManagerTypes";
import { BN_ZERO, toBN } from "../utils/helpers";
import { Prices } from "./Prices";
import { eventIs } from "../utils/events/truffle";
import { web3DeepNormalize, web3Normalize } from "../utils/web3normalize";
import { web3 } from "../utils/web3";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import assert from "node:assert";
import { LiquidationStrategyImplSettings, decodeLiquidationStrategyImplSettings } from "../fasset/LiquidationStrategyImpl";
import { CollateralList, isPoolCollateral } from "./CollateralIndexedList";
import { tokenContract } from "./TokenPrice";

export class TrackedState {
    constructor(
        public context: IAssetTrackedStateContext,
        private lastEventBlockHandled: number
    ) { }

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
    agents: Map<string, TrackedAgentState> = new Map();                // map agent_address => tracked agent state
    agentsByUnderlying: Map<string, TrackedAgentState> = new Map();    // map underlying_address => tracked agent state
    agentsByPool: Map<string, TrackedAgentState> = new Map();    // map pool_address => tracked agent state

    // event decoder
    eventDecoder = new Web3EventDecoder({ ftsoManager: this.context.ftsoManager, assetManager: this.context.assetManager });

    // async initialization part
    async initialize(): Promise<void> {
        // settings
        this.settings = Object.assign({}, await this.context.assetManager.getSettings());
        const encodedSettings = await this.context.assetManager.getLiquidationSettings();
        this.liquidationStrategySettings = decodeLiquidationStrategyImplSettings(encodedSettings);
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
        // prices
        [this.prices, this.trustedPrices] = await this.getPrices();
    }

    async getPrices(): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.context.ftsoRegistry, this.settings, this.context.collaterals);
    }

    async registerStateEvents(events: EvmEvent[]): Promise<void> {
        try {
            for (const event of events) {
                if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    [this.prices, this.trustedPrices] = await this.getPrices();
                } else if (eventIs(event, this.context.assetManager, 'SettingChanged')) {
                    if (event.args.name === 'liquidationStepSeconds') {
                        (this.liquidationStrategySettings as any)[event.args.name] = web3Normalize(event.args.value)
                    } else if (!(event.args.name in this.settings)) {
                        assert.fail(`Invalid setting change ${event.args.name}`);
                    } else {
                        (this.settings as any)[event.args.name] = web3Normalize(event.args.value);
                    }
                } else if (eventIs(event, this.context.assetManager, 'SettingArrayChanged')) {
                    if (!(event.args.name in this.liquidationStrategySettings)) assert.fail(`Invalid setting array change ${event.args.name}`);
                    (this.liquidationStrategySettings as any)[event.args.name] = web3DeepNormalize(event.args.value);
                } else if (eventIs(event, this.context.assetManager, 'AgentSettingChanged')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleAgentSettingChanged(event.args.name, event.args.value);
                } else if (eventIs(event, this.context.assetManager, 'MintingExecuted')) {
                    this.fAssetSupply = this.fAssetSupply.add(toBN(event.args.mintedAmountUBA).add(toBN(event.args.poolFeeUBA)));
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleMintingExecuted(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    this.fAssetSupply = this.fAssetSupply.sub(toBN(event.args.valueUBA));
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionRequested(event.args);
                } else if (eventIs(event, this.context.assetManager, 'SelfClose')) {
                    this.fAssetSupply = this.fAssetSupply.sub(toBN(event.args.valueUBA));
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleSelfClose(event.args);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationPerformed')) {
                    this.fAssetSupply = this.fAssetSupply.sub(toBN(event.args.valueUBA));
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleLiquidationPerformed(event.args);
                } else if (eventIs(event, this.context.assetManager, 'CollateralTypeAdded')) {
                    void this.addCollateralType({ ...event.args, validUntil: BN_ZERO });
                } else if (eventIs(event, this.context.assetManager, 'CollateralRatiosChanged')) {
                    const collateral = this.collaterals.get(event.args.collateralClass, event.args.collateralToken);
                    collateral.minCollateralRatioBIPS = toBN(event.args.minCollateralRatioBIPS);
                    collateral.ccbMinCollateralRatioBIPS = toBN(event.args.ccbMinCollateralRatioBIPS);
                    collateral.safetyMinCollateralRatioBIPS = toBN(event.args.safetyMinCollateralRatioBIPS);
                } else if (eventIs(event, this.context.assetManager, 'CollateralTypeDeprecated')) {
                    const collateral = this.collaterals.get(event.args.collateralClass, event.args.collateralToken);
                    collateral.validUntil = toBN(event.args.validUntil);
                } else if (eventIs(event, this.context.assetManager, 'AgentCreated')) {
                    this.createAgent(event.args);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    this.destroyAgent(event.args);
                } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.CCB, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationStarted')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.LIQUIDATION, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'FullLiquidationStarted')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.FULL_LIQUIDATION, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationEnded')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.NORMAL);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyAnnounced')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleStatusChange(AgentStatus.DESTROYING, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'AgentAvailable')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleAgentAvailable(event.args);
                } else if (eventIs(event, this.context.assetManager, 'AvailableAgentExited')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleAvailableAgentExited();
                } else if (eventIs(event, this.context.assetManager, 'CollateralReserved')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleCollateralReserved(event.args);
                } else if (eventIs(event, this.context.assetManager, 'MintingPaymentDefault')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleMintingPaymentDefault(event.args);
                } else if (eventIs(event, this.context.assetManager, 'CollateralReservationDeleted')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleCollateralReservationDeleted(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPerformed')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionPerformed(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionDefault')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionDefault(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentBlocked')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionPaymentBlocked(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentFailed')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleRedemptionPaymentFailed(event.args);
                } else if (eventIs(event, this.context.assetManager, 'UnderlyingBalanceToppedUp')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingBalanceToppedUp(event.args);
                } else if (eventIs(event, this.context.assetManager, 'UnderlyingWithdrawalAnnounced')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingWithdrawalAnnounced(event.args);
                } else if (eventIs(event, this.context.assetManager, 'UnderlyingWithdrawalConfirmed')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingWithdrawalConfirmed(event.args);
                } else if (eventIs(event, this.context.assetManager, 'UnderlyingWithdrawalCancelled')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleUnderlyingWithdrawalCancelled();
                } else if (eventIs(event, this.context.assetManager, 'DustChanged')) {
                    (await this.getAgentTriggerAdd(event.args.agentVault)).handleDustChanged(event.args);
                }
                for (const collateral of this.collaterals.list) {
                    const contract = await tokenContract(collateral.token);
                    if (eventIs(event, contract, 'Transfer')) {
                        this.agents.get(event.args.from)?.withdrawClass1Collateral(contract.address, toBN(event.args.value));
                        this.agents.get(event.args.to)?.depositClass1Collateral(contract.address, toBN(event.args.value));
                        this.agentsByPool.get(event.args.from)?.withdrawPoolCollateral(toBN(event.args.value));
                        this.agentsByPool.get(event.args.to)?.depositPoolCollateral(toBN(event.args.value));
                    }
                }
            }
        } catch (error) {
            console.error(`Error handling events for state: ${error}`);
        }
    }

    async readUnhandledEvents(): Promise<EvmEvent[]> {
        // get all needed logs for state
        const nci = this.context.nativeChainInfo;
        const lastBlock = await web3.eth.getBlockNumber() - nci.finalizationBlocks;
        const events: EvmEvent[] = [];
        for (let lastHandled = this.lastEventBlockHandled; lastHandled < lastBlock; lastHandled += nci.readLogsChunkSize) {
            // handle collaterals
            for (const collateral of this.collaterals.list) {
                const contract = await tokenContract(collateral.token);
                const logsCollateral = await web3.eth.getPastLogs({
                    address: contract.address,
                    fromBlock: lastHandled + 1,
                    toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                    topics: [null]
                });
                const eventDecoderCollaterals = new Web3EventDecoder({ collateralDecode: contract });
                events.push(...eventDecoderCollaterals.decodeEvents(logsCollateral));
            }
            // handle asset manager
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
            // handle ftso manager
            const logsFtsoManager = await web3.eth.getPastLogs({
                address: this.context.ftsoManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logsFtsoManager));
        }
        // mark as handled
        this.lastEventBlockHandled = lastBlock;
        // run state events
        events.sort((a,b) => a.blockNumber - b.blockNumber);
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
        return collateral;
    }

    async createAgentWithCurrentState(vaultAddress: string): Promise<TrackedAgentState> {
        const agentInfo = await this.context.assetManager.getAgentInfo(vaultAddress);
        const agent = this.createAgent({
            agentVault: vaultAddress,
            owner: agentInfo.ownerColdWalletAddress,
            underlyingAddress: agentInfo.underlyingAddressString,
            collateralPool: agentInfo.collateralPool,
            class1CollateralToken: agentInfo.class1CollateralToken,
            feeBIPS: agentInfo.feeBIPS,
            poolFeeShareBIPS: agentInfo.poolFeeShareBIPS,
            mintingClass1CollateralRatioBIPS: agentInfo.mintingClass1CollateralRatioBIPS,
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
        const agent = new TrackedAgentState(this, data);
        this.agents.set(agent.vaultAddress, agent);
        this.agentsByUnderlying.set(agent.underlyingAddress, agent);
        this.agentsByPool.set(agent.collateralPoolAddress, agent);
        return agent;
    }

    destroyAgent(args: EventArgs<AgentDestroyed>): void {
        const agent = this.getAgent(args.agentVault);
        if (agent) {
            this.agents.delete(args.agentVault);
            this.agentsByUnderlying.delete(agent.underlyingAddress);
            this.agentsByPool.delete(agent.collateralPoolAddress);
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
