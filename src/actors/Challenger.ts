import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { ActorBase } from "../fasset-bots/ActorBase";
import { AgentStatus } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { AttestationHelperError } from "../underlying-chain/AttestationHelper";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { EventArgs } from "../utils/events/common";
import { EventScope } from "../utils/events/ScopedEvents";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { getOrCreate, sleep, sumBN, toBN } from "../utils/helpers";
import { web3DeepNormalize } from "../utils/web3normalize";

const MAX_NEGATIVE_BALANCE_REPORT = 50;  // maximum number of transactions to report in freeBalanceNegativeChallenge to avoid breaking block gas limit
interface ActiveRedemption {
    agentAddress: string;
    amount: BN;
    // underlying block and timestamp after which the redemption payment is invalid and can be challenged
    validUntilBlock: BN;
    validUntilTimestamp: BN;
}

export class Challenger extends ActorBase {
    constructor(
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState,
        public lastEventUnderlyingBlockHandled: number
    ) {
        super(runner, address, state);
     }

    activeRedemptions = new Map<string, ActiveRedemption>();                        // paymentReference => { agent vault address, requested redemption amount }
    transactionForPaymentReference = new Map<string, string>();                     // paymentReference => transaction hash
    unconfirmedTransactions = new Map<string, Map<string, ITransaction>>();         // agentVaultAddress => (txHash => transaction)
    challengedAgents = new Set<string>();

    /**
     * This is the main method, where "automatic" logic is gathered.
     * Firstly, it collects unhandled events on native chain, runs through them and handles them appropriately.
     * Lastly, it collects all unhandled transactions on underlying chain and handles them appropriately.
     */
    override async runStep(): Promise<void> {
        await this.registerEvents();
    }

    /**
     * Performs appropriate actions according to received native events and underlying transactions.
     */
    async registerEvents(): Promise<void> {
        try {
            // Native chain events and update state events
            const events = await this.state.readUnhandledEvents();
            for (const event of events) {
                if (eventIs(event, this.state.context.assetManager, 'RedemptionRequested')) {
                    this.handleRedemptionRequested(event.args);
                } else if (eventIs(event, this.state.context.assetManager, 'RedemptionPerformed')) {
                    await this.handleRedemptionFinished(event.args);
                } else if (eventIs(event, this.state.context.assetManager, 'RedemptionPaymentBlocked')) {
                    await this.handleRedemptionFinished(event.args);
                } else if (eventIs(event, this.state.context.assetManager, 'RedemptionPaymentFailed')) {
                    await this.handleRedemptionFinished(event.args);
                } else if (eventIs(event, this.state.context.assetManager, 'UnderlyingWithdrawalConfirmed')) {
                    await this.handleTransactionConfirmed(event.args.agentVault, event.args.transactionHash);
                }
            }
        } catch (error) {
            console.error(`Error handling events for challenger ${this.address}: ${error}`);
        }
        // Underlying chain events
        const from = this.lastEventUnderlyingBlockHandled;
        const to = await this.getLatestUnderlyingBlock();
        const transactions = await this.state.context.blockchainIndexer.getTransactionsWithinBlockRange(from, to, true);
        for (const transaction of transactions) {
            this.handleUnderlyingTransaction(transaction);
        }
        // mark as handled
        this.lastEventUnderlyingBlockHandled = to;
    }

    handleUnderlyingTransaction(transaction: ITransaction): void {
        for (const [address] of transaction.inputs) {
            const agent = this.state.agentsByUnderlying.get(address);
            if (!agent) continue;
            // add to list of transactions
            this.addUnconfirmedTransaction(agent, transaction);
            // illegal transaction challenge
            this.checkForIllegalTransaction(transaction, agent);
            // double payment challenge
            this.checkForDoublePayment(transaction, agent);
            // negative balance challenge
            this.checkForNegativeFreeBalance(agent);
        }
    }

    async handleTransactionConfirmed(agentVault: string, transactionHash: string): Promise<void> {
        this.deleteUnconfirmedTransaction(agentVault, transactionHash);
        // also re-check free balance
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        this.checkForNegativeFreeBalance(agent);
    }

    handleRedemptionRequested(args: EventArgs<RedemptionRequested>): void {
        this.activeRedemptions.set(args.paymentReference, {
            agentAddress: args.agentVault,
            amount: toBN(args.valueUBA),
            // see Challenges.sol for this calculation
            validUntilBlock: toBN(args.lastUnderlyingBlock).add(toBN(this.state.settings.underlyingBlocksForPayment)),
            validUntilTimestamp: toBN(args.lastUnderlyingTimestamp).add(toBN(this.state.settings.underlyingSecondsForPayment)),
        });
    }

    async handleRedemptionFinished(args: { requestId: BN; agentVault: string; transactionHash: string; }): Promise<void> {
        // clean up transactionForPaymentReference tracking - after redemption is finished the payment reference is immediately illegal anyway
        const reference = PaymentReference.redemption(args.requestId);
        this.transactionForPaymentReference.delete(reference);
        this.activeRedemptions.delete(reference);
        // also mark transaction as confirmed
        await this.handleTransactionConfirmed(args.agentVault, args.transactionHash);
    }

    // illegal transactions

    checkForIllegalTransaction(transaction: ITransaction, agent: TrackedAgentState) {
        const transactionValid = PaymentReference.isValid(transaction.reference)
            && (this.isValidRedemptionReference(agent, transaction.reference) || this.isValidAnnouncedPaymentReference(agent, transaction.reference));
        // if the challenger starts tracking later, activeRedemptions might not hold all active redemeptions,
        // but that just means there will be a few unnecessary illegal transaction challenges, which is perfectly safe
        if (!transactionValid && agent.status !== AgentStatus.FULL_LIQUIDATION) {
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agent));
        }
    }

    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agent: TrackedAgentState) {
        await this.singleChallengePerAgent(agent, async () => {
            const proof = await this.waitForDecreasingBalanceProof(scope, transaction.hash, agent.underlyingAddress);
            // due to async nature of challenging (and the fact that challenger might start tracking agent later), there may be some false challenges which will be rejected
            // this is perfectly safe for the system, but the errors must be caught
            await this.state.context.assetManager.illegalPaymentChallenge(web3DeepNormalize(proof), agent.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg: already liquidating', 'chlg: transaction confirmed', 'matching redemption active', 'matching ongoing announced pmt']));
        });
    }

    // double payments

    checkForDoublePayment(transaction: ITransaction, agent: TrackedAgentState) {
        if (!PaymentReference.isValid(transaction.reference)) return;   // handled by illegal payment challenge
        const existingHash = this.transactionForPaymentReference.get(transaction.reference);
        if (existingHash && existingHash != transaction.hash) {
            this.runner.startThread((scope) => this.doublePaymentChallenge(scope, transaction.hash, existingHash, agent));
        } else {
            this.transactionForPaymentReference.set(transaction.reference, transaction.hash);
        }
    }

    async doublePaymentChallenge(scope: EventScope, tx1hash: string, tx2hash: string, agent: TrackedAgentState) {
        await this.singleChallengePerAgent(agent, async () => {
            const [proof1, proof2] = await Promise.all([
                this.waitForDecreasingBalanceProof(scope, tx1hash, agent.underlyingAddress),
                this.waitForDecreasingBalanceProof(scope, tx2hash, agent.underlyingAddress),
            ]);
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.state.context.assetManager.doublePaymentChallenge(web3DeepNormalize(proof1), web3DeepNormalize(proof2), agent.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg dbl: already liquidating']));
        });
    }

    // free balance negative

    checkForNegativeFreeBalance(agent: TrackedAgentState) {
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
            } else if (this.isValidAnnouncedPaymentReference(agent, transaction.reference)) {
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
        if (totalSpent.gt(agent.freeUnderlyingBalanceUBA)) {
            const transactionHashes = transactions.map(tx => tx.txHash);
            this.runner.startThread((scope) => this.freeBalanceNegativeChallenge(scope, transactionHashes, agent));
        }
    }

    async freeBalanceNegativeChallenge(scope: EventScope, transactionHashes: string[], agent: TrackedAgentState) {
        await this.singleChallengePerAgent(agent, async () => {
            const proofs = await Promise.all(transactionHashes.map(txHash =>
                this.waitForDecreasingBalanceProof(scope, txHash, agent.underlyingAddress)));
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.state.context.assetManager.freeBalanceNegativeChallenge(web3DeepNormalize(proofs), agent.vaultAddress, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['mult chlg: already liquidating', 'mult chlg: enough balance']));
        });
    }

    // utils

    isValidRedemptionReference(agent: TrackedAgentState, reference: string) {
        const redemption = this.activeRedemptions.get(reference);
        if (redemption == null) return false;
        return agent.vaultAddress === redemption.agentAddress;
    }

    isValidAnnouncedPaymentReference(agent: TrackedAgentState, reference: string) {
        return !agent.announcedUnderlyingWithdrawalId.isZero() && reference === PaymentReference.announcedWithdrawal(agent.announcedUnderlyingWithdrawalId);
    }

    addUnconfirmedTransaction(agent: TrackedAgentState, transaction: ITransaction) {
        getOrCreate(this.unconfirmedTransactions, agent.vaultAddress, () => new Map()).set(transaction.hash, transaction);
    }

    deleteUnconfirmedTransaction(agentVault: string, transactionHash: string) {
        const agentTransactions = this.unconfirmedTransactions.get(agentVault);
        if (agentTransactions) {
            agentTransactions.delete(transactionHash);
            if (agentTransactions.size === 0) this.unconfirmedTransactions.delete(agentVault);
        }
    }

    async waitForDecreasingBalanceProof(scope: EventScope, txHash: string, underlyingAddressString: string) {
        await this.state.context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
        return await this.state.context.attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAddressString)
            .catch(e => scope.exitOnExpectedError(e, [AttestationHelperError]));
    }

    async singleChallengePerAgent(agent: TrackedAgentState, body: () => Promise<void>) {
        while (this.challengedAgents.has(agent.vaultAddress)) {
            await sleep(1);
        }
        try {
            this.challengedAgents.add(agent.vaultAddress);
            if (agent.status === AgentStatus.FULL_LIQUIDATION) return;
            await body();
        } finally {
            this.challengedAgents.delete(agent.vaultAddress);
        }
    }

    async getLatestUnderlyingBlock(): Promise<number> {
        const blockHeight = await this.state.context.blockchainIndexer.getBlockHeight();
        return blockHeight;
    }
}
