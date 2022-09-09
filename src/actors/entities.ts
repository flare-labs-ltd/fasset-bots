import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity()
export class WalletAddress {
    @PrimaryKey()
    address!: string;
    
    @Property()
    encryptedPrivateKey!: string;
}

@Entity({ schema: 'Agent' })
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
}

@Entity()
export class Redemption {
    @PrimaryKey()
    id!: number;
    
    @Property()
    state!: 'start' | 'paid' | 'requestedProof' | 'done';

    // status: 'active' | 'defaulted'

    // 'start' state data

    @Property()
    agentAddress!: string;

    @Property()
    requestId!: BN;

    @Property()
    paymentAddress!: string;

    @Property()
    valueUBA!: BN;

    @Property()
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
