import { Collection, Entity, Enum, EnumType, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import { BNType } from "../config/orm-types";
import { BN_ZERO } from "../utils/helpers";
import { ADDRESS_LENGTH, BYTES32_LENGTH } from "./common";
import { EvmEvent } from "../utils/events/common";
import { eventOrder } from "../utils/events/common";

@Entity({ tableName: "agent" })
export class AgentEntity {
    // vaultAddress is unique across chains (but can repeat in different native networks, so don't use the same db for agents in Songbird and Flare)
    @PrimaryKey({ length: ADDRESS_LENGTH })
    vaultAddress!: string;

    @Property({ length: ADDRESS_LENGTH })
    collateralPoolAddress!: string;

    @Property()
    chainId!: string;

    @Property()
    chainSymbol!: string;

    @Property()
    ownerAddress!: string;

    @Property()
    underlyingAddress!: string;

    @Property()
    active!: boolean;

    @Property({ nullable: true })
    currentEventBlock!: number;

    @OneToMany(() => EventEntity, event => event.agent, { orphanRemoval: true })
    events = new Collection<EventEntity>(this);

    addEvent(event: EventEntity): void {
        if (this.events.isInitialized()) {
            // remove previously handled events before adding this one
            // we track the last read event along with all the unhandled ones!
            this.events.remove(this.events.filter(event => event.handled))
        }
        this.events.add(event)
    }

    lastEventRead(): EventEntity | undefined {
        if (this.events.isInitialized()) {
            const ordered = this.events.getItems().sort(eventOrder)
            return ordered[ordered.length - 1]
        }
    }

    unhandledEvents(): EventEntity[] {
        return this.events.isInitialized()
            ? this.events.getItems().filter(event => !event.handled)
            : []
    }

    // agent destroy

    @Property()
    waitingForDestructionCleanUp: boolean = false;

    @Property({ type: BNType })
    waitingForDestructionTimestamp: BN = BN_ZERO;

    @Property({ type: BNType })
    poolTokenRedemptionWithdrawalAllowedAtTimestamp: BN = BN_ZERO;

    @Property()
    poolTokenRedemptionWithdrawalAllowedAtAmount: string = "";

    @Property({ type: BNType })
    destroyVaultCollateralWithdrawalAllowedAtTimestamp: BN = BN_ZERO;

    @Property()
    destroyVaultCollateralWithdrawalAllowedAtAmount: string = "";

    // agent exit available list

    @Property({ type: BNType })
    exitAvailableAllowedAtTimestamp: BN = BN_ZERO;

    // agent update settings

    @Property({ type: BNType })
    agentSettingUpdateValidAtFeeBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtPoolFeeShareBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtMintingVaultCRBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtMintingPoolCRBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtPoolExitCRBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtPoolTopupCRBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtpoolTopupTokenPriceFactorBIPS: BN = BN_ZERO;

    // agent withdraw vault collateral

    @Property({ type: BNType })
    withdrawalAllowedAtTimestamp: BN = BN_ZERO;

    @Property()
    withdrawalAllowedAtAmount: string = "";

    // agent withdraw underlying

    @Property({ type: BNType })
    underlyingWithdrawalAnnouncedAtTimestamp: BN = BN_ZERO;

    @Property()
    underlyingWithdrawalConfirmTransaction: string = "";

    // agent cancel underlying announcement

    @Property()
    underlyingWithdrawalWaitingForCancelation: boolean = false;

    // last time daily tasks were checked

    @Property({ type: BNType, defaultRaw: BN_ZERO.toString() })
    dailyTasksTimestamp: BN = BN_ZERO;

    @Enum({ type: EnumType, defaultRaw: "obtainedProof" })
    dailyProofState!: DailyProofState;

    @Property({ nullable: true })
    dailyProofRequestRound?: number;

    @Property({ nullable: true })
    dailyProofRequestData?: string;
}

// For agent, minting only has to be tracked to react to unpaid mintings or mintings which were
// paid but the proof wasn't presented.
@Entity()
@Unique({ properties: ["agentAddress", "requestId"] })
export class AgentMinting {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    state!: AgentMintingState;

    @Property({ length: ADDRESS_LENGTH })
    agentAddress!: string;

    @Property({ length: ADDRESS_LENGTH })
    agentUnderlyingAddress!: string;

    @Property({ type: BNType })
    requestId!: BN;

    @Property({ type: BNType })
    valueUBA!: BN;

    @Property({ type: BNType })
    feeUBA!: BN;

    @Property({ type: BNType })
    firstUnderlyingBlock!: BN;

    @Property({ type: BNType })
    lastUnderlyingBlock!: BN;

    @Property({ type: BNType })
    lastUnderlyingTimestamp!: BN;

    @Property({ length: BYTES32_LENGTH })
    paymentReference!: string;

    // 'REQUEST_PAYMENT_PROOF' and 'REQUEST_NON_PAYMENT_PROOF' state data
    // when in state REQUEST_PAYMENT_PROOF, it stores roundId and data to later obtain the proof

    @Property({ nullable: true })
    proofRequestRound?: number;

    @Property({ nullable: true })
    proofRequestData?: string;
}

// For agent, redemption needs to be tracked, so that agent pays it, obtains proof of payment and confirms it.
// In corner case it can happen that proof of payment does not exist anymore, in that case agent obtains the proof of it and calls finishRedemptionWithoutPayment
@Entity()
@Unique({ properties: ["agentAddress", "requestId"] })
export class AgentRedemption {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    state!: AgentRedemptionState;

    // 'START' state data

    @Property({ length: ADDRESS_LENGTH })
    agentAddress!: string;

    @Property({ type: BNType })
    requestId!: BN;

    @Property({ length: BYTES32_LENGTH })
    paymentAddress!: string;

    @Property({ type: BNType })
    valueUBA!: BN;

    @Property({ type: BNType })
    feeUBA!: BN;

    @Property({ type: BNType })
    lastUnderlyingBlock!: BN;

    @Property({ type: BNType })
    lastUnderlyingTimestamp!: BN;

    @Property({ length: BYTES32_LENGTH })
    paymentReference!: string;

    // 'PAID' state data

    @Property({ nullable: true })
    txHash?: string;

    // 'REQUESTED_PROOF' state data

    @Property({ nullable: true })
    proofRequestRound?: number;

    @Property({ nullable: true })
    proofRequestData?: string;
}

@Entity()
export class EventEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    blockNumber!: number;

    @Property()
    transactionIndex!: number;

    @Property()
    logIndex!: number;

    @Property()
    handled: boolean = false;

    @ManyToOne(() => AgentEntity)
    agent!: AgentEntity;

    constructor(agent: AgentEntity, event: EvmEvent, handled: boolean) {
        this.blockNumber = event.blockNumber;
        this.transactionIndex = event.transactionIndex;
        this.logIndex = event.logIndex;
        this.handled = handled;
        this.agent = agent;
    }
}

export enum DailyProofState {
    WAITING_PROOF = "waitingProof",
    OBTAINED_PROOF = "obtainedProof",
}

export enum AgentMintingState {
    DONE = "done",
    STARTED = "started",
    REQUEST_NON_PAYMENT_PROOF = "requestedNonPaymentProof",
    REQUEST_PAYMENT_PROOF = "requestedPaymentProof",
}

export enum AgentRedemptionState {
    DONE = "done",
    STARTED = "started",
    PAID = "paid",
    REQUESTED_PROOF = "requestedProof",
    NOT_REQUESTED_PROOF = "notRequestedProof",
}
