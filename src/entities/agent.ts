import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import { BNType } from "../config/orm-types";
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
}

// For agent, minting only has to be tracked to react to unpaid mintings or mintings which were
// paid but the proof wasn't presented.
@Entity()
@Unique({ properties: ['agentAddress', 'requestId'] })
export class AgentMinting {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    state!: 'started' | 'done';

    @Property({ length: ADDRESS_LENGTH })
    agentAddress!: string;

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
}

@Entity()
@Unique({ properties: ['agentAddress', 'requestId'] })
export class AgentRedemption {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    state!: 'started' | 'paid' | 'requestedProof' | 'done';

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
