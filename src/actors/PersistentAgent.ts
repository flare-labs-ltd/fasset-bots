import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { IAssetContext } from "../fasset/IAssetContext";
import { PersistenceContext } from "../config/PersistenceContext";
import { ProvedDH } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { EventArgs } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { isNotNull, toBN } from "../utils/helpers";
import { DHPayment } from "../verification/generated/attestation-hash-types";
import { Agent } from "./Agent";
import { AgentEntity, Redemption } from "./entities";
import { web3 } from "../utils/web3";
import { SqlEntityManager } from "@mikro-orm/sqlite";

const AgentVault = artifacts.require('AgentVault');

export class PersistentAgent {
    constructor(
        public agent: Agent,
        public pc: PersistenceContext
    ) { }

    context = this.agent.context;
    eventDecoder = new Web3EventDecoder({ assetManager: this.context.assetManager });

    static async create(pc: PersistenceContext, context: IAssetContext, ownerAddress: string) {
        await pc.em.transactional(async em => {
            const underlyingAddress = await context.wallet.createAccount();
            // TODO: add EOA proof when needed
            const agent = await Agent.create(context, ownerAddress, underlyingAddress);
            const agentEntity = new AgentEntity();
            agentEntity.chainId = context.chainInfo.chainId;
            agentEntity.ownerAddress = agent.ownerAddress;
            agentEntity.vaultAddress = agent.agentVault.address;
            agentEntity.underlyingAddress = agent.underlyingAddress;
            agentEntity.active = true;
            em.persist(agentEntity);
            return new PersistentAgent(agent, pc);
        });
    }

    static async fromEntity(pc: PersistenceContext, context: IAssetContext, agentEntity: AgentEntity) {
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        const agent = new Agent(context, agentEntity.ownerAddress, agentVault, agentEntity.underlyingAddress);
        return new PersistentAgent(agent, pc);
    }

    async handleEvents() {
        await this.pc.em.transactional(async em => {
            const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress });
            // get all logs for this agent
            const lastBlock = await web3.eth.getBlockNumber() - 1;  // TODO: should put finalization blocks here?
            const rawLogs = await web3.eth.getPastLogs({
                address: this.agent.assetManager.address,
                fromBlock: agentEnt.lastEventBlockHandled ?? lastBlock,
                toBlock: lastBlock,
                topics: [null, this.agent.vaultAddress]
            });
            const events = rawLogs.map(log => this.eventDecoder.decodeEvent(log)).filter(isNotNull);
            // handle events
            // Note: only update db here, so that error won't retry on-chain operations.
            for (const event of events) {
                if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    this.startRedemption(em, event.args);
                }
            }
            // mark as handled
            agentEnt.lastEventBlockHandled = lastBlock;
        }).catch(error => {
            console.error(`Error handling events for agent ${this.agent.vaultAddress}`);
        });;
    }

    startRedemption(em: SqlEntityManager, request: EventArgs<RedemptionRequested>) {
        const redemption = new Redemption();
        redemption.state = 'start';
        redemption.agentAddress = this.agent.agentVault.address;
        redemption.requestId = toBN(request.requestId);
        redemption.paymentAddress = request.paymentAddress;
        redemption.valueUBA = toBN(request.valueUBA);
        redemption.feeUBA = toBN(request.feeUBA);
        redemption.paymentReference = request.paymentReference;
        em.persist(redemption);
    }

    async handleOpenRedemptions() {
        const openRedemptions = await this.pc.em.createQueryBuilder(Redemption)
            .select('id')
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: 'done' } })
            .getResultList();
        for (const rd of openRedemptions) {
            await this.nextRedemptionStep(rd.id);
        }
    }

    async nextRedemptionStep(id: number) {
        await this.pc.em.transactional(async em => {
            const redemption = await this.pc.em.getRepository(Redemption).findOneOrFail({ id: Number(id) });
            if (redemption.state === 'start') {
                await this.payForRedemption(redemption);
            } if (redemption.state === 'paid') {
                await this.checkPaymentProofAvailable(redemption);
            } else if (redemption.state === 'requestedProof') {
                await this.checkConfirmPayment(redemption);
            }
        }).catch(error => {
            console.error(`Error handling next redemption step for redemption ${id} agent ${this.agent.vaultAddress}`);
        });
    }

    async payForRedemption(redemption: Redemption) {
        const paymentAmount = redemption.valueUBA.sub(redemption.feeUBA);
        // !!! TODO: what if there are too little funds on underlying address to pay for fee?
        const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
        redemption.txHash = txHash;
    }

    async checkPaymentProofAvailable(redemption: Redemption) {
        const txBlock = await this.context.chain.getTransactionBlock(redemption.txHash!);
        const blockHeight = await this.context.chain.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.chain.finalizationBlocks) {
            await this.requestPaymentProof(redemption);
        }
    }

    async requestPaymentProof(redemption: Redemption) {
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash!, this.agent.underlyingAddress, redemption.paymentAddress);
        redemption.state = 'requestedProof';
        redemption.proofRequestRound = request.round;
        redemption.proofRequestData = request.data;
    }

    async checkConfirmPayment(redemption: Redemption) {
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.confirmRedemptionPayment(paymentProof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = 'done';
        } else {
            // TODO: payment happened but we cannot obtain proof... ALERT!!!
        }
    }

}
