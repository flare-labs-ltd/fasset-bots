import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { BNType } from "../config/orm-types";

@Entity()
export class WalletAddress {
    @PrimaryKey()
    address!: string;
    
    @Property()
    encryptedPrivateKey!: string;
}

@Entity({ tableName: 'agent' })
export class AgentEntity {
    // vaultAddress is unique accross chains (but can repeat in different native networks, so don't use the same db for agents in Songbird and Flare)
    @PrimaryKey()
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

@Entity()
export class AgentMinting {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    state!: 'start' | 'done';

    @Property()
    agentAddress!: string;
    
    @Property({ type: BNType })
    requestId!: BN;

    @Property()
    paymentReference!: string;
}

@Entity()
export class AgentRedemption {
    @PrimaryKey({ autoincrement: true })
    id!: number;
    
    @Property()
    state!: 'start' | 'paid' | 'requestedProof' | 'done';

    // status: 'active' | 'defaulted'

    // 'start' state data

    @Property()
    agentAddress!: string;

    @Property({ type: BNType })
    requestId!: BN;

    @Property()
    paymentAddress!: string;

    @Property({ type: BNType })
    valueUBA!: BN;

    @Property({ type: BNType })
    feeUBA!: BN;

    @Property()
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
