import { FilterQuery } from "@mikro-orm/core/typings";
import { RedemptionFinished, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { ActorEntity, ActorType } from "../entities/actor";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { TrackedAgent } from "../state/TrackedAgent";
import { TrackedState } from "../state/TrackedState";
import { AttestationClientError, ProvedDH } from "../underlying-chain/AttestationHelper";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { EventScope } from "../utils/events/ScopedEvents";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { getOrCreate, sleep, sumBN, systemTimestamp, toBN } from "../utils/helpers";
import { web3 } from "../utils/web3";
import { DHBalanceDecreasingTransaction } from "../verification/generated/attestation-hash-types";
import { AgentStatus } from "./AgentBot";

const MAX_NEGATIVE_BALANCE_REPORT = 50;  // maximum number of transactions to report in freeBalanceNegativeChallenge to avoid breaking block gas limit

export class Challenger {
    constructor(
        public runner: ScopedRunner,
        public context: IAssetBotContext,
        public address: string,
        public state: TrackedState
    ) { }

    activeRedemptions = new Map<string, { agentAddress: string, amount: BN }>();    // paymentReference => { agent vault address, requested redemption amount }
    transactionForPaymentReference = new Map<string, string>();                     // paymentReference => transaction hash
    unconfirmedTransactions = new Map<string, Map<string, ITransaction>>();         // agentVaultAddress => (txHash => transaction)
    challengedAgents = new Set<string>();
    eventDecoder = new Web3EventDecoder({ assetManager: this.context.assetManager });

    static async create(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string, state: TrackedState): Promise<Challenger> {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const challengerEntity = new ActorEntity();
            challengerEntity.chainId = context.chainInfo.chainId;
            challengerEntity.address = address;
            challengerEntity.lastEventBlockHandled = lastBlock;
            challengerEntity.lastEventTimestampHandled = systemTimestamp();
            challengerEntity.type = ActorType.CHALLENGER;
            em.persist(challengerEntity);
            const challenger = new Challenger(runner, context, address, state);
            return challenger;
        });
    }

    static async fromEntity(runner: ScopedRunner, context: IAssetBotContext, challengerEntity: ActorEntity, state: TrackedState): Promise<Challenger> {
        return new Challenger(runner, context, challengerEntity.address, state);
    }

    async runStep(em: EM): Promise<void> {
        await this.registerEvents(em);
    }

    async registerEvents(rootEm: EM): Promise<void> {
        await rootEm.transactional(async em => {
            // Underlying chain events
            const challengerEnt = await em.findOneOrFail(ActorEntity, { address: this.address } as FilterQuery<ActorEntity>);
            let from = challengerEnt.lastEventTimestampHandled!;
            const to = systemTimestamp();
            const transactions = await this.context.blockChainIndexerClient.getTransactionsWithinTimestampRange(from, to);
            for (const transaction of transactions) {
                await this.handleUnderlyingTransaction(transaction);
            }
            // mark as handled
            challengerEnt.lastEventTimestampHandled = to;

            // Native chain events
            const events = await this.readUnhandledEvents(challengerEnt);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                // console.log(this.context.assetManager.address, event.address, event.event);
                if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    this.handleRedemptionRequested(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionFinished')) {
                    this.handleRedemptionFinished(event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPerformed')) {
                    await this.handleTransactionConfirmed(event.args.agentVault, event.args.transactionHash);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentBlocked')) {
                    await this.handleTransactionConfirmed(event.args.agentVault, event.args.transactionHash);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentFailed')) {
                    await this.handleTransactionConfirmed(event.args.agentVault, event.args.transactionHash);
                } else if (eventIs(event, this.context.assetManager, 'UnderlyingWithdrawalConfirmed')) {
                    await this.handleTransactionConfirmed(event.args.agentVault, event.args.transactionHash);
                } else if (eventIs(event, this.context.assetManager, 'AgentCreated')) {
                    this.state.createAgent(event.args.agentVault, event.args.owner, event.args.underlyingAddress);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    this.state.destroyAgent(event.args);
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

    async handleUnderlyingTransaction(transaction: ITransaction): Promise<void> {
        for (const [address, amount] of transaction.inputs) {
            const agent = this.state.agentsByUnderlying.get(address);
            if (agent == null) continue;
            // add to list of transactions
            this.addUnconfirmedTransaction(agent, transaction);
            // illegal transaction challenge
            await this.checkForIllegalTransaction(transaction, agent);
            // double payment challenge
            this.checkForDoublePayment(transaction, agent);
            // negative balance challenge
            await this.checkForNegativeFreeBalance(agent);
        }
    }

    async handleTransactionConfirmed(agentVault: string, transactionHash: string): Promise<void> {
        this.deleteUnconfirmedTransaction(agentVault, transactionHash);
        // also re-check free balance
        const agent = this.state.getAgent(agentVault);
        if (agent) await this.checkForNegativeFreeBalance(agent);
    }

    handleRedemptionRequested(args: EventArgs<RedemptionRequested>): void {
        this.activeRedemptions.set(args.paymentReference, { agentAddress: args.agentVault, amount: toBN(args.valueUBA) });
    }

    handleRedemptionFinished(args: EventArgs<RedemptionFinished>): void {
        // clean up transactionForPaymentReference tracking - after redemption is finished the payment reference is immediatelly illegal anyway
        const reference = PaymentReference.redemption(args.requestId);
        this.transactionForPaymentReference.delete(reference);
        this.activeRedemptions.delete(reference);
    }

    // illegal transactions
    async checkForIllegalTransaction(transaction: ITransaction, agent: TrackedAgent): Promise<void> {
        const transactionValid = PaymentReference.isValid(transaction.reference)
            && (this.isValidRedemptionReference(agent, transaction.reference) || await this.isValidAnnouncedPaymentReference(agent, transaction.reference));
        // if the challenger starts tracking later, activeRedemptions might not hold all active redemeptions,
        // but that just means there will be a few unnecessary illegal transaction challenges, which is perfectly safe
        const agentInfo = await this.getAgentInfo(agent.vaultAddress);
        if (!transactionValid && Number(agentInfo.status) !== AgentStatus.FULL_LIQUIDATION) {
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agent));
        }
    }

    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agent: TrackedAgent): Promise<void> {
        await this.singleChallengePerAgent(agent, async () => {
            const proof = await this.waitForDecreasingBalanceProof(scope, transaction.hash, agent.underlyingAddress);
            // due to async nature of challenging (and the fact that challenger might start tracking agent later), there may be some false challenges which will be rejected
            // this is perfectly safe for the system, but the errors must be caught
            await this.context.assetManager.illegalPaymentChallenge(proof, agent.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg: already liquidating', 'chlg: transaction confirmed', 'matching redemption active', 'matching ongoing announced pmt']));
        });
    }

    // double payments

    checkForDoublePayment(transaction: ITransaction, agent: TrackedAgent): void {
        if (!PaymentReference.isValid(transaction.reference)) return;   // handled by illegal payment challenge
        const existingHash = this.transactionForPaymentReference.get(transaction.reference);
        if (existingHash && existingHash != transaction.hash) {
            this.runner.startThread((scope) => this.doublePaymentChallenge(scope, transaction.hash, existingHash, agent));
        } else {
            this.transactionForPaymentReference.set(transaction.reference, transaction.hash);
        }
    }

    async doublePaymentChallenge(scope: EventScope, tx1hash: string, tx2hash: string, agent: TrackedAgent): Promise<void> {
        await this.singleChallengePerAgent(agent, async () => {
            const [proof1, proof2] = await Promise.all([
                this.waitForDecreasingBalanceProof(scope, tx1hash, agent.underlyingAddress),
                this.waitForDecreasingBalanceProof(scope, tx2hash, agent.underlyingAddress),
            ]);
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.context.assetManager.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg dbl: already liquidating']));
        });
    }

    // free balance negative

    async checkForNegativeFreeBalance(agent: TrackedAgent): Promise<void> {
        const agentTransactions = this.unconfirmedTransactions.get(agent.vaultAddress);
        if (agentTransactions == null) return;
        // extract the spent value for each transaction
        let transactions: Array<{ txHash: string, spent: BN }> = [];
        for (const transaction of agentTransactions.values()) {
            if (!PaymentReference.isValid(transaction.reference)) continue;     // should be caught by illegal payment challenge
            const spentAmount = transaction.inputs.find(input => input[0] === agent.underlyingAddress)?.[1];
            if (spentAmount == null) continue;
            if (this.isValidRedemptionReference(agent, transaction.reference)) {
                const { amount } = this.activeRedemptions.get(transaction.reference)!;
                transactions.push({ txHash: transaction.hash, spent: spentAmount.sub(amount) });
            } else if (await this.isValidAnnouncedPaymentReference(agent, transaction.reference)) {
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
        const agenInfo = await this.getAgentInfo(agent.vaultAddress);
        if (totalSpent.gt(toBN(agenInfo.freeUnderlyingBalanceUBA))) {
            const transactionHashes = transactions.map(tx => tx.txHash);
            this.runner.startThread((scope) => this.freeBalanceNegativeChallenge(scope, transactionHashes, agent));
        }
    }

    async freeBalanceNegativeChallenge(scope: EventScope, transactionHashes: string[], agent: TrackedAgent): Promise<void> {
        await this.singleChallengePerAgent(agent, async () => {
            const proofs = await Promise.all(transactionHashes.map(txHash =>
                this.waitForDecreasingBalanceProof(scope, txHash, agent.underlyingAddress)));
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.context.assetManager.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['mult chlg: already liquidating', 'mult chlg: enough free balance', 'mult chlg: payment confirmed']));
        });
    }

    // utils

    isValidRedemptionReference(agent: TrackedAgent, reference: string): boolean {
        const redemption = this.activeRedemptions.get(reference);
        if (redemption === undefined) return false;
        return agent.vaultAddress === redemption.agentAddress;
    }

    async isValidAnnouncedPaymentReference(agent: TrackedAgent, reference: string): Promise<boolean> {
        const agentInfo = await this.getAgentInfo(agent.vaultAddress);
        return !toBN(agentInfo.announcedUnderlyingWithdrawalId).isZero() && reference === PaymentReference.announcedWithdrawal(agentInfo.announcedUnderlyingWithdrawalId);
    }

    addUnconfirmedTransaction(agent: TrackedAgent, transaction: ITransaction): void {
        getOrCreate(this.unconfirmedTransactions, agent.vaultAddress, () => new Map()).set(transaction.hash, transaction);
    }

    deleteUnconfirmedTransaction(agentVault: string, transactionHash: string): void {
        const agentTransactions = this.unconfirmedTransactions.get(agentVault);
        if (agentTransactions) {
            agentTransactions.delete(transactionHash);
            if (agentTransactions.size === 0) this.unconfirmedTransactions.delete(agentVault);
        }
    }

    async waitForDecreasingBalanceProof(scope: EventScope, txHash: string, underlyingAddressString: string): Promise<ProvedDH<DHBalanceDecreasingTransaction>> {
        await this.context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash);
        return await this.context.attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAddressString)
            .catch(e => scope.exitOnExpectedError(e, [AttestationClientError]));
    }

    async singleChallengePerAgent(agent: TrackedAgent, body: () => Promise<void>): Promise<void> {
        while (this.challengedAgents.has(agent.vaultAddress)) {
            await sleep(1);
        }
        try {
            this.challengedAgents.add(agent.vaultAddress);
            const agentInfo = await this.getAgentInfo(agent.vaultAddress);
            if (Number(agentInfo.status) === AgentStatus.FULL_LIQUIDATION) return;
            await body();
        } finally {
            this.challengedAgents.delete(agent.vaultAddress);
        }
    }

    private async getAgentInfo(agentVault: string): Promise<AgentInfo> {
        return await this.context.assetManager.getAgentInfo(agentVault);
    }
}
