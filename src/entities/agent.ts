import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import { AgentStatus } from "../actors/AgentBot";
import { BNType } from "../config/orm-types";
import { toBN } from "../utils/helpers";
import { ADDRESS_LENGTH, BYTES32_LENGTH } from "./common";

@Entity({ tableName: 'agent' })
export class AgentEntity {
    // vaultAddress is unique accross chains (but can repeat in different native networks, so don't use the same db for agents in Songbird and Flare)
    @PrimaryKey({ length: ADDRESS_LENGTH })
    vaultAddress!: string;

    @Property()
    chainId!: number;

    @Property()
    ownerAddress!: string;

    @Property()
    underlyingAddress!: string;

    @Property()
    active!: boolean;

    @Property({ nullable: true })
    lastEventBlockHandled!: number;

    @Property({ type: BNType })
    ccbStartTimestamp: BN = toBN(0);

    @Property({ type: BNType })
    liquidationStartTimestamp: BN = toBN(0);

    @Property()
    status: AgentStatus = AgentStatus.NORMAL;
}

// For agent, minting only has to be tracked to react to unpaid mintings or mintings which were
// paid but the proof wasn't presented.
@Entity()
@Unique({ properties: ['agentAddress', 'requestId'] })
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
    lastUnderlyingBlock!: BN;

    @Property({ type: BNType })
    lastUnderlyingTimestamp!: BN;

    @Property({ length: BYTES32_LENGTH })
    paymentReference!: string;

    // 'requestedNonPaymentProof' state data
    // TODO - can these fields be reused for 'requestedPaymentProof' state data

    @Property({ nullable: true })
    proofRequestRound?: number;

    @Property({ nullable: true })
    proofRequestData?: string;
}

@Entity()
@Unique({ properties: ['agentAddress', 'requestId'] })
export class AgentRedemption {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    state!: AgentRedemptionState;

    // status: 'active' | 'defaulted'

    // 'start' state data

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

    // 'paid' state data

    @Property({ nullable: true })
    txHash?: string;

    // 'requestedProof' state data

    @Property({ nullable: true })
    proofRequestRound?: number;

    @Property({ nullable: true })
    proofRequestData?: string;

    // 'confirmed' state data
}

export enum AgentMintingState {
    DONE = 'done',
    STARTED = 'started',
    REQUEST_NON_PAYMENT_PROOF = 'requestedNonPaymentProof',
    REQUEST_PAYMENT_PROOF = 'requestedPaymentProof'
}

export enum AgentRedemptionState {
    DONE = 'done',
    STARTED = 'started',
    PAID = 'paid',
    REQUESTED_PROOF = 'requestedProof',
    NOT_REQUESTED_PROOF = 'notRequestedProof'
}