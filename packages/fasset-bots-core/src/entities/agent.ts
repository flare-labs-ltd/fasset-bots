import { Cascade, Collection, Entity, Enum, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import { BNType } from "../config/orm-types";
import { BN_ZERO } from "../utils/helpers";
import { ADDRESS_LENGTH, BYTES32_LENGTH } from "./common";
import { EvmEvent } from "../utils/events/common";
import { eventOrder } from "../utils/events/common";
import BN from "bn.js";

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

    @OneToMany(() => Event, (event) => event.agent, {
        orphanRemoval: true,
        cascade: [Cascade.ALL],
    })
    events = new Collection<Event>(this);

    addNewEvent(event: Event): void {
        // remove previously handled events before adding this one
        // we track the last read event along with all the unhandled ones!
        this.events.remove(this.events.filter((_event) => _event.handled));
        this.events.add(event);
    }

    lastEventRead(): Event | undefined {
        const ordered = this.events.getItems().sort(eventOrder);
        return ordered[ordered.length - 1];
    }
    /* istanbul ignore next */ //until handling is not implemented
    unhandledEvents(): Event[] {
        return this.events.getItems().filter((event) => !event.handled);
    }

    // agent destroy

    @Property()
    waitingForDestructionCleanUp: boolean = false;

    @Property({ type: BNType })
    waitingForDestructionTimestamp: BN = BN_ZERO;

    @Property({ type: BNType })
    destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp: BN = BN_ZERO;

    @Property()
    destroyPoolTokenRedemptionWithdrawalAllowedAtAmount: string = "";

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
    agentSettingUpdateValidAtMintingVaultCrBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtMintingPoolCrBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtPoolExitCrBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtPoolTopupCrBIPS: BN = BN_ZERO;

    @Property({ type: BNType })
    agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS: BN = BN_ZERO;

    // redeem pool tokens

    @Property({ type: BNType })
    poolTokenRedemptionWithdrawalAllowedAtTimestamp: BN = BN_ZERO;

    @Property()
    poolTokenRedemptionWithdrawalAllowedAtAmount: string = "";

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

    @Enum({ type: 'DailyProofState', columnType: 'varchar(20)', default: "obtainedProof" })
    dailyProofState!: DailyProofState;

    @Property({ nullable: true })
    dailyProofRequestRound?: number;

    @Property({ nullable: true, type: "text" })
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

    @Property({ nullable: true, type: "text" })
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

    // 'REQUESTED_PROOF' or 'REQUESTED_REJECTION_PROOF' state data

    @Property({ nullable: true })
    proofRequestRound?: number;

    @Property({ nullable: true, type: "text" })
    proofRequestData?: string;
}

@Entity()
export class Event {
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

    @Property()
    retries: number = 0;

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
    REQUESTED_REJECTION_PROOF = "requestedRejectionProof",
}
