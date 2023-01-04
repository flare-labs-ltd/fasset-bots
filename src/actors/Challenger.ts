import { FilterQuery } from "@mikro-orm/core/typings";
import { RedemptionFinished, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { ActorEntity, ActorType } from "../entities/actor";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { AttestationClientError } from "../underlying-chain/AttestationHelper";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { EvmEvent } from "../utils/events/common";
import { EvmEventArgs } from "../utils/events/IEvmEvents";
import { EventScope } from "../utils/events/ScopedEvents";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { getOrCreate, sleep, sumBN, systemTimestamp, toBN } from "../utils/helpers";
import { web3 } from "../utils/web3";
import { AgentStatus } from "./AgentBot";

const MAX_NEGATIVE_BALANCE_REPORT = 50;  // maximum number of transactions to report in freeBalanceNegativeChallenge to avoid breaking block gas limit

export class Challenger {
    constructor(
        public runner: ScopedRunner,
        public address: string,
        public context: IAssetBotContext,
    ) {
    }

    activeRedemptions = new Map<string, { agentAddress: string, amount: BN }>();    // paymentReference => { agent vault address, requested redemption amount }
    transactionForPaymentReference = new Map<string, string>();                     // paymentReference => transaction hash
    unconfirmedTransactions = new Map<string, Map<string, ITransaction>>();         // agentVaultAddress => (txHash => transaction)
    challengedAgents = new Set<string>();
    eventDecoder = new Web3EventDecoder({ assetManager: this.context.assetManager });

    static async create(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string) {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const challengerEntity = new ActorEntity();
            challengerEntity.chainId = context.chainInfo.chainId;
            challengerEntity.address = address;
            challengerEntity.lastEventBlockHandled = lastBlock;
            challengerEntity.lastEventTimestampHandled = systemTimestamp();
            challengerEntity.type = ActorType.CHALLENGER;
            em.persist(challengerEntity);
            const challenger = new Challenger(runner, address, context);
            return challenger;
        });
    }

    static async fromEntity(runner: ScopedRunner, context: IAssetBotContext, challengerEntity: ActorEntity) {
        return new Challenger(runner, challengerEntity.address, context);
    }

    async runStep(em: EM) {
        await this.registerEvents(em);
    }

    async registerEvents(rootEm: EM) {
        await rootEm.transactional(async em => {
            // Underlying chain events
            const challengerEnt = await em.findOneOrFail(ActorEntity, { address: this.address } as FilterQuery<ActorEntity>);
            let from = challengerEnt.lastEventTimestampHandled!;
            const to = systemTimestamp();
            const transactions = await this.context.blockChainIndexerClient.getTransactionsWithinTimestampRange(from, to);
            for (const transaction of transactions) {
                await this.handleUnderlyingTransaction(em, transaction);
            }
            // mark as handled
            challengerEnt.lastEventTimestampHandled = to;

            // Native chain events
            const events = await this.readUnhandledEvents(challengerEnt);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                // console.log(this.context.assetManager.address, event.address, event.event);
                if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    this.handleRedemptionRequested(event.args)
                } else if (eventIs(event, this.context.assetManager, 'RedemptionFinished')) {
                    this.handleRedemptionFinished(event.args)
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPerformed')) {
                    await this.handleTransactionConfirmed(em, event.args.agentVault, event.args.transactionHash)
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentBlocked')) {
                    await this.handleTransactionConfirmed(em, event.args.agentVault, event.args.transactionHash)
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentFailed')) {
                    await this.handleTransactionConfirmed(em, event.args.agentVault, event.args.transactionHash)
                } else if (eventIs(event, this.context.assetManager, 'UnderlyingWithdrawalConfirmed')) {
                    await this.handleTransactionConfirmed(em, event.args.agentVault, event.args.transactionHash)
                }
            }
        }).catch(error => {
            console.error(`Error handling events for challenger ${this.address}: ${error}`);
        });
    }

    async readUnhandledEvents(challengerEnt: ActorEntity): Promise<EvmEvent[]> {
        // get all logs for this challenger
        const nci = this.context.nativeChainInfo;
        const lastBlock = await web3.eth.getBlockNumber() - nci.finalizationBlocks;
        const events: EvmEvent[] = [];
        for (let lastHandled = challengerEnt.lastEventBlockHandled; lastHandled < lastBlock; lastHandled += nci.readLogsChunkSize) {
            const logs = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logs));
        }
        // mark as handled
        challengerEnt.lastEventBlockHandled = lastBlock;
        return events;
    }

    async handleUnderlyingTransaction(em: EM, transaction: ITransaction): Promise<void> {
        for (const [address, amount] of transaction.inputs) {
            const agentEnt = await em.findOne(AgentEntity, { underlyingAddress: address } as FilterQuery<AgentEntity>);
            if (agentEnt == null) continue;
            // add to list of transactions - OK
            this.addUnconfirmedTransaction(agentEnt, transaction);
            // illegal transaction challenge
            await this.checkForIllegalTransaction(transaction, agentEnt);
            // double payment challenge
            this.checkForDoublePayment(transaction, agentEnt);
            // negative balance challenge
            await this.checkForNegativeFreeBalance(agentEnt);
        }
    }

    async handleTransactionConfirmed(em: EM, agentVault: string, transactionHash: string): Promise<void> {
        this.deleteUnconfirmedTransaction(agentVault, transactionHash);
        // also re-check free balance
        const agentEnt = await em.findOne(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        if (agentEnt) await this.checkForNegativeFreeBalance(agentEnt);
    }

    handleRedemptionRequested(args: EvmEventArgs<RedemptionRequested>): void {
        this.activeRedemptions.set(args.paymentReference, { agentAddress: args.agentVault, amount: toBN(args.valueUBA) });
    }

    handleRedemptionFinished(args: EvmEventArgs<RedemptionFinished>): void {
        // clean up transactionForPaymentReference tracking - after redemption is finished the payment reference is immediatelly illegal anyway
        const reference = PaymentReference.redemption(args.requestId);
        this.transactionForPaymentReference.delete(reference);
        this.activeRedemptions.delete(reference);
    }

    // illegal transactions

    async checkForIllegalTransaction(transaction: ITransaction, agentEnt: AgentEntity) {
        const transactionValid = PaymentReference.isValid(transaction.reference)
            && (this.isValidRedemptionReference(agentEnt, transaction.reference) || await this.isValidAnnouncedPaymentReference(agentEnt, transaction.reference));
        // if the challenger starts tracking later, activeRedemptions might not hold all active redemeptions,
        // but that just means there will be a few unnecessary illegal transaction challenges, which is perfectly safe
        const agentInfo = await this.getAgentInfo(agentEnt.vaultAddress);
        if (!transactionValid && Number(agentInfo.status) !== AgentStatus.FULL_LIQUIDATION) {
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agentEnt));
        }
    }

    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agentEnt: AgentEntity) {
        await this.singleChallengePerAgent(agentEnt, async () => {
            const proof = await this.waitForDecreasingBalanceProof(scope, transaction.hash, agentEnt.underlyingAddress);
            // due to async nature of challenging (and the fact that challenger might start tracking agent later), there may be some false challenges which will be rejected
            // this is perfectly safe for the system, but the errors must be caught
            await this.context.assetManager.illegalPaymentChallenge(proof, agentEnt.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg: already liquidating', 'chlg: transaction confirmed', 'matching redemption active', 'matching ongoing announced pmt']));
        });
    }

    // double payments

    checkForDoublePayment(transaction: ITransaction, agentEnt: AgentEntity) {
        if (!PaymentReference.isValid(transaction.reference)) return;   // handled by illegal payment challenge
        const existingHash = this.transactionForPaymentReference.get(transaction.reference);
        if (existingHash && existingHash != transaction.hash) {
            this.runner.startThread((scope) => this.doublePaymentChallenge(scope, transaction.hash, existingHash, agentEnt));
        } else {
            this.transactionForPaymentReference.set(transaction.reference, transaction.hash);
        }
    }

    async doublePaymentChallenge(scope: EventScope, tx1hash: string, tx2hash: string, agentEnt: AgentEntity) {
        await this.singleChallengePerAgent(agentEnt, async () => {
            const [proof1, proof2] = await Promise.all([
                this.waitForDecreasingBalanceProof(scope, tx1hash, agentEnt.underlyingAddress),
                this.waitForDecreasingBalanceProof(scope, tx2hash, agentEnt.underlyingAddress),
            ]);
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.context.assetManager.doublePaymentChallenge(proof1, proof2, agentEnt.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg dbl: already liquidating']));
        });
    }

    // free balance negative

    async checkForNegativeFreeBalance(agentEnt: AgentEntity) {
        const agentTransactions = this.unconfirmedTransactions.get(agentEnt.vaultAddress);
        if (agentTransactions == null) return;
        // extract the spent value for each transaction
        let transactions: Array<{ txHash: string, spent: BN }> = [];
        for (const transaction of agentTransactions.values()) {
            if (!PaymentReference.isValid(transaction.reference)) continue;     // should be caught by illegal payment challenge
            const spentAmount = transaction.inputs.find(input => input[0] === agentEnt.underlyingAddress)?.[1];
            if (spentAmount == null) continue;
            if (this.isValidRedemptionReference(agentEnt, transaction.reference)) {
                const { amount } = this.activeRedemptions.get(transaction.reference)!;
                transactions.push({ txHash: transaction.hash, spent: spentAmount.sub(amount) });
            } else if (await this.isValidAnnouncedPaymentReference(agentEnt, transaction.reference)) {
                transactions.push({ txHash: transaction.hash, spent: spentAmount });
            }
            // other options should be caught by illegal payment challenge
        }
        // sort by decreasing spent amount
        transactions.sort((a, b) => a.spent.gt(b.spent) ? -1 : a.spent.lt(b.spent) ? 1 : 0);
        // extract highest MAX_REPORT transactions
        transactions = transactions.slice(0, MAX_NEGATIVE_BALANCE_REPORT);
        // initiate challenge if total spent is big enough
        const totalSpent = sumBN(transactions, tx => tx.spent);
        const agenInfo = await this.getAgentInfo(agentEnt.vaultAddress);
        if (totalSpent.gt(agenInfo.freeUnderlyingBalanceUBA)) {
            const transactionHashes = transactions.map(tx => tx.txHash);
            this.runner.startThread((scope) => this.freeBalanceNegativeChallenge(scope, transactionHashes, agentEnt));
        }
    }

    async freeBalanceNegativeChallenge(scope: EventScope, transactionHashes: string[], agentEnt: AgentEntity) {
        await this.singleChallengePerAgent(agentEnt, async () => {
            const proofs = await Promise.all(transactionHashes.map(txHash =>
                this.waitForDecreasingBalanceProof(scope, txHash, agentEnt.underlyingAddress)));
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.context.assetManager.freeBalanceNegativeChallenge(proofs, agentEnt.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['mult chlg: already liquidating', 'mult chlg: enough free balance', 'mult chlg: payment confirmed']));
        });
    }

    // utils

    isValidRedemptionReference(agentEnt: AgentEntity, reference: string) {
        const redemption = this.activeRedemptions.get(reference);
        if (redemption == null) return false;
        return agentEnt.vaultAddress === redemption.agentAddress;
    }

    async isValidAnnouncedPaymentReference(agentEnt: AgentEntity, reference: string) {
        const agentInfo = await this.getAgentInfo(agentEnt.vaultAddress);
        return !toBN(agentInfo.announcedUnderlyingWithdrawalId).isZero() && reference === PaymentReference.announcedWithdrawal(agentInfo.announcedUnderlyingWithdrawalId);
    }

    addUnconfirmedTransaction(agentEnt: AgentEntity, transaction: ITransaction) {
        getOrCreate(this.unconfirmedTransactions, agentEnt.vaultAddress, () => new Map()).set(transaction.hash, transaction);
    }

    deleteUnconfirmedTransaction(agentVault: string, transactionHash: string) {
        const agentTransactions = this.unconfirmedTransactions.get(agentVault);
        if (agentTransactions) {
            agentTransactions.delete(transactionHash);
            if (agentTransactions.size === 0) this.unconfirmedTransactions.delete(agentVault);
        }
    }

    async waitForDecreasingBalanceProof(scope: EventScope, txHash: string, underlyingAddressString: string) {
        await this.context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash);
        return await this.context.attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAddressString)
            .catch(e => scope.exitOnExpectedError(e, [AttestationClientError]));
    }

    async singleChallengePerAgent(agentEnt: AgentEntity, body: () => Promise<void>) {
        while (this.challengedAgents.has(agentEnt.vaultAddress)) {
            await sleep(1);
        }
        try {
            this.challengedAgents.add(agentEnt.vaultAddress);
            const agentInfo = await this.getAgentInfo(agentEnt.vaultAddress);
            if (Number(agentInfo.status) === AgentStatus.FULL_LIQUIDATION) return;
            await body();
        } finally {
            this.challengedAgents.delete(agentEnt.vaultAddress);
        }
    }

    private async getAgentInfo(agentVault: string): Promise<AgentInfo> {
        return await this.context.assetManager.getAgentInfo(agentVault);
    }
}
