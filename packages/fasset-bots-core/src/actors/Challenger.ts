import BN from "bn.js";
import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { ActorBase, ActorBaseKind } from "../fasset-bots/ActorBase";
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
import { formatArgs } from "../utils/formatting";
import { compareHexValues, getOrCreate, sleep, sumBN, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { Notifier } from "../utils/Notifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { ChallengeStrategy, DefaultChallengeStrategy } from "./plugins/ChallengeStrategy";

const MAX_NEGATIVE_BALANCE_REPORT = 50; // maximum number of transactions to report in freeBalanceNegativeChallenge to avoid breaking block gas limit
interface ActiveRedemption {
    agentAddress: string;
    amount: BN;
    // underlying block and timestamp after which the redemption payment is invalid and can be challenged
    validUntilBlock: BN;
    validUntilTimestamp: BN;
}

export class Challenger extends ActorBase {
    challengeStrategy: ChallengeStrategy;

    constructor(
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState,
        public lastEventUnderlyingBlockHandled: number,
        public notifier: Notifier | undefined
    ) {
        super(runner, address, state);
        if (state.context.challengeStrategy === undefined) {
            this.challengeStrategy = new DefaultChallengeStrategy(state, address);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const strategies = require("./plugins/ChallengeStrategy");
            this.challengeStrategy = new strategies[state.context.challengeStrategy.className](state, address);
        }
    }

    activeRedemptions = new Map<string, ActiveRedemption>(); // paymentReference => { agent vault address, requested redemption amount }
    transactionForPaymentReference = new Map<string, string>(); // paymentReference => transaction hash
    unconfirmedTransactions = new Map<string, Map<string, ITransaction>>(); // agentVaultAddress => (txHash => transaction)
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
            logger.info(`Challenger ${this.address} started reading unhandled native events.`);
            const events = await this.state.readUnhandledEvents();
            logger.info(`Challenger ${this.address} finished reading unhandled native events.`);
            for (const event of events) {
                if (eventIs(event, this.state.context.assetManager, "RedemptionRequested")) {
                    logger.info(`Challenger ${this.address} received event 'RedemptionRequested' with data ${formatArgs(event.args)}.`);
                    this.handleRedemptionRequested(event.args);
                    logger.info(`Challenger ${this.address} stored active redemption: ${formatArgs(event.args)}.`);
                } else if (eventIs(event, this.state.context.assetManager, "RedemptionPerformed")) {
                    logger.info(`Challenger ${this.address} received event 'RedemptionPerformed' with data ${formatArgs(event.args)}.`);
                    await this.handleRedemptionFinished(event.args);
                    logger.info(`Challenger ${this.address} deleted active redemption: ${formatArgs(event.args)}.`);
                } else if (eventIs(event, this.state.context.assetManager, "RedemptionPaymentBlocked")) {
                    logger.info(`Challenger ${this.address} received event 'RedemptionPaymentBlocked' with data ${formatArgs(event.args)}.`);
                    await this.handleRedemptionFinished(event.args);
                    logger.info(`Challenger ${this.address} deleted active redemption: ${formatArgs(event.args)}.`);
                } else if (eventIs(event, this.state.context.assetManager, "RedemptionPaymentFailed")) {
                    logger.info(`Challenger ${this.address} received event 'RedemptionPaymentFailed' with data ${formatArgs(event.args)}.`);
                    await this.handleRedemptionFinished(event.args);
                    logger.info(`Challenger ${this.address} deleted active redemption: ${formatArgs(event.args)}.`);
                } else if (eventIs(event, this.state.context.assetManager, "UnderlyingWithdrawalConfirmed")) {
                    logger.info(`Challenger ${this.address} received event 'UnderlyingWithdrawalConfirmed' with data ${formatArgs(event.args)}.`);
                    await this.handleTransactionConfirmed(event.args.agentVault, event.args.transactionHash);
                }
            }
        } catch (error) {
            console.error(`Error handling events for challenger ${this.address}: ${error}`);
            logger.error(`Challenger ${this.address} run into error while handling events:`, error);
        }
        // Underlying chain events
        const from = this.lastEventUnderlyingBlockHandled;
        const to = await this.getLatestUnderlyingBlock();
        logger.info(`Challenger ${this.address} started reading unhandled underlying transactions FROM ${from} TO ${to}.`);
        const transactions = await this.state.context.blockchainIndexer!.getTransactionsWithinBlockRange(from, to);
        logger.info(`Challenger ${this.address} finished reading unhandled underlying transactions FROM ${from} TO ${to}.`);
        for (const transaction of transactions) {
            this.handleUnderlyingTransaction(transaction);
        }
        // mark as handled
        this.lastEventUnderlyingBlockHandled = to + 1;
    }

    /**
     * @param transaction received underlying transaction
     */
    handleUnderlyingTransaction(transaction: ITransaction): void {
        for (const [address] of transaction.inputs) {
            const agent = this.state.agentsByUnderlying.get(address);
            if (!agent) continue;
            logger.info(`Challenger ${this.address} started handling underlying transaction ${transaction.hash}.`);
            // add to list of transactions
            this.addUnconfirmedTransaction(agent, transaction);
            // illegal transaction challenge
            this.checkForIllegalTransaction(transaction, agent);
            // double payment challenge
            this.checkForDoublePayment(transaction, agent);
            // negative balance challenge
            this.checkForNegativeFreeBalance(agent);
            logger.info(`Challenger ${this.address} finished handling underlying transaction ${transaction.hash}.`);
        }
    }

    /**
     * @param agentVault agent's vault address
     * @param transactionHash underlying transaction's hash
     */
    async handleTransactionConfirmed(agentVault: string, transactionHash: string): Promise<void> {
        this.deleteUnconfirmedTransaction(agentVault, transactionHash);
        // also re-check free balance
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        this.checkForNegativeFreeBalance(agent);
    }

    /**
     * @param args event's RedemptionRequested arguments
     */
    handleRedemptionRequested(args: EventArgs<RedemptionRequested>): void {
        this.activeRedemptions.set(args.paymentReference, {
            agentAddress: args.agentVault,
            amount: toBN(args.valueUBA),
            // see Challenges.sol for this calculation
            validUntilBlock: toBN(args.lastUnderlyingBlock).add(toBN(this.state.settings.underlyingBlocksForPayment)),
            validUntilTimestamp: toBN(args.lastUnderlyingTimestamp).add(toBN(this.state.settings.underlyingSecondsForPayment)),
        });
    }

    /**
     * @param args object containing redemption request id, agent's vault address and underlying transaction hash
     */
    async handleRedemptionFinished(args: { requestId: BN; agentVault: string; transactionHash: string }): Promise<void> {
        // clean up transactionForPaymentReference tracking - after redemption is finished the payment reference is immediately illegal anyway
        const reference = PaymentReference.redemption(args.requestId);
        this.transactionForPaymentReference.delete(reference);
        this.activeRedemptions.delete(reference);
        // also mark transaction as confirmed
        await this.handleTransactionConfirmed(args.agentVault, args.transactionHash);
    }

    // illegal transactions

    /**
     * @param transaction underlying transaction
     * @param agent instance of TrackedAgentState
     */
    checkForIllegalTransaction(transaction: ITransaction, agent: TrackedAgentState): void {
        logger.info(`Challenger ${this.address} is checking agent ${agent.vaultAddress} for illegal transaction ${transaction.hash}.`);
        console.log(`Challenger ${this.address} is checking agent ${agent.vaultAddress} for illegal transaction ${transaction.hash}.`);
        const transactionValid =
            PaymentReference.isValid(transaction.reference) &&
            (this.isValidRedemptionReference(agent, transaction.reference) || this.isValidAnnouncedPaymentReference(agent, transaction.reference));
        // if the challenger starts tracking later, activeRedemptions might not hold all active redemeptions,
        // but that just means there will be a few unnecessary illegal transaction challenges, which is perfectly safe
        if (!transactionValid && agent.status !== AgentStatus.FULL_LIQUIDATION) {
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agent));
        }
    }

    /**
     * @param scope
     * @param transaction underlying transaction
     * @param agent instance of TrackedAgentState
     */
    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agent: TrackedAgentState) {
        logger.info(`Challenger ${this.address} is challenging agent ${agent.vaultAddress} for illegal transaction ${transaction.hash}.`);
        console.log(`Challenger ${this.address} is challenging agent ${agent.vaultAddress} for illegal transaction ${transaction.hash}.`);
        await this.singleChallengePerAgent(agent, async () => {
            const proof = await this.waitForDecreasingBalanceProof(scope, transaction.hash, agent.underlyingAddress);
            await this.challengeStrategy.illegalTransactionChallenge(scope, agent, web3DeepNormalize(proof));
            logger.info(`Challenger ${this.address} successfully challenged agent ${agent.vaultAddress} for illegal transaction ${transaction.hash}.`);
            await this.notifier?.sendIllegalTransactionChallenge(this.address, agent.vaultAddress, transaction.hash);
        });
    }

    // double payments

    /**
     * @param transaction underlying transaction
     * @param agent instance of TrackedAgentState
     */
    checkForDoublePayment(transaction: ITransaction, agent: TrackedAgentState) {
        logger.info(`Challenger ${this.address} is checking agent ${agent.vaultAddress} for double payments ${transaction.hash}.`);
        console.log(`Challenger ${this.address} is checking agent ${agent.vaultAddress} for double payments ${transaction.hash}.`);
        if (!PaymentReference.isValid(transaction.reference)) return; // handled by illegal payment challenge
        const existingHash = this.transactionForPaymentReference.get(transaction.reference);
        if (existingHash && existingHash != transaction.hash) {
            this.runner.startThread((scope) => this.doublePaymentChallenge(scope, transaction.hash, existingHash, agent));
        } else {
            this.transactionForPaymentReference.set(transaction.reference, transaction.hash);
        }
    }

    /**
     * @param scope
     * @param tx1hash underlying transaction made with same payment reference as tx2hash
     * @param tx2hash underlying transaction made with same payment reference as tx1hash
     * @param agent instance of TrackedAgentState
     */
    async doublePaymentChallenge(scope: EventScope, tx1hash: string, tx2hash: string, agent: TrackedAgentState) {
        logger.info(`Challenger ${this.address} is challenging agent ${agent.vaultAddress} for double payments for ${tx1hash} and ${tx2hash}.`);
        console.log(`Challenger ${this.address} is challenging agent ${agent.vaultAddress} for double payments for ${tx1hash} and ${tx2hash}.`);
        await this.singleChallengePerAgent(agent, async () => {
            const [proof1, proof2] = await Promise.all([
                this.waitForDecreasingBalanceProof(scope, tx1hash, agent.underlyingAddress),
                this.waitForDecreasingBalanceProof(scope, tx2hash, agent.underlyingAddress),
            ]);
            await this.challengeStrategy.doublePaymentChallenge(scope, agent, web3DeepNormalize(proof1), web3DeepNormalize(proof2));
            logger.info(`Challenger ${this.address} successfully challenged agent ${agent.vaultAddress} for double payments for ${tx1hash} and ${tx2hash}.`);
            await this.notifier?.sendDoublePaymentChallenge(this.address, agent.vaultAddress, tx1hash, tx2hash);
        });
    }

    // free balance negative

    /**
     * @param agent instance of TrackedAgentState
     */
    checkForNegativeFreeBalance(agent: TrackedAgentState) {
        logger.info(`Challenger ${this.address} is checking agent ${agent.vaultAddress} for free negative balance for agent ${agent.vaultAddress}.`);
        console.log(`Challenger ${this.address} is checking agent ${agent.vaultAddress} for free negative balance for agent ${agent.vaultAddress}.`);
        const agentTransactions = this.unconfirmedTransactions.get(agent.vaultAddress);
        if (agentTransactions == null) return;
        // extract the spent value for each transaction
        let transactions: Array<{ txHash: string; spent: BN }> = [];
        for (const transaction of agentTransactions.values()) {
            if (!PaymentReference.isValid(transaction.reference)) continue; // should be caught by illegal payment challenge
            const spentAmount: BN = toBN(0);
            for (const input of transaction.inputs) {
                /* istanbul ignore else */
                if (input[0] === agent.underlyingAddress) spentAmount.iadd(input[1]);
            }
            for (const output of transaction.outputs) {
                if (output[0] === agent.underlyingAddress) spentAmount.isub(output[1]);
            }
            if (spentAmount.lten(0)) continue;
            if (this.isValidRedemptionReference(agent, transaction.reference)) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const { amount } = this.activeRedemptions.get(transaction.reference)!;
                transactions.push({ txHash: transaction.hash, spent: spentAmount.sub(amount) });
            } else if (this.isValidAnnouncedPaymentReference(agent, transaction.reference)) {
                transactions.push({ txHash: transaction.hash, spent: spentAmount });
            }
            // other options should be caught by illegal payment challenge
        }
        // sort by decreasing spent amount
        /* istanbul ignore next */
        transactions.sort((a, b) => (a.spent.gt(b.spent) ? -1 : a.spent.lt(b.spent) ? 1 : 0));
        // extract highest MAX_REPORT transactions
        transactions = transactions.slice(0, MAX_NEGATIVE_BALANCE_REPORT);
        // initiate challenge if total spent is big enough
        const totalSpent = sumBN(transactions, (tx) => tx.spent);
        if (totalSpent.gt(agent.freeUnderlyingBalanceUBA)) {
            const transactionHashes = transactions.map((tx) => tx.txHash);
            this.runner.startThread((scope) => this.freeBalanceNegativeChallenge(scope, transactionHashes, agent));
        }
    }

    /**
     * @param scope
     * @param transactionHashes list of 'unauthorized' transaction hashes
     * @param agent instance of TrackedAgentState
     */
    async freeBalanceNegativeChallenge(scope: EventScope, transactionHashes: string[], agent: TrackedAgentState) {
        logger.info(`Challenger ${this.address} is challenging agent ${agent.vaultAddress} for free negative balance.`);
        console.log(`Challenger ${this.address} is challenging agent ${agent.vaultAddress} for free negative balance.`);
        await this.singleChallengePerAgent(agent, async () => {
            const proofs = await Promise.all(transactionHashes.map((txHash) => this.waitForDecreasingBalanceProof(scope, txHash, agent.underlyingAddress)));
            await this.challengeStrategy.freeBalanceNegativeChallenge(scope, agent, web3DeepNormalize(proofs));
            logger.info(`Challenger ${this.address} successfully challenged agent ${agent.vaultAddress} for free negative balance.`);
            await this.notifier?.sendFreeBalanceNegative(this.address, agent.vaultAddress);
        });
    }

    // utils

    /**
     * @param agent instance of TrackedAgentState
     * @param reference payment reference
     */
    isValidRedemptionReference(agent: TrackedAgentState, reference: string) {
        const redemption = this.activeRedemptions.get(reference);
        if (redemption == null) return false;
        return agent.vaultAddress === redemption.agentAddress;
    }

    /**
     * @param agent instance of TrackedAgentState
     * @param reference payment reference
     */
    isValidAnnouncedPaymentReference(agent: TrackedAgentState, reference: string) {
        return !agent.announcedUnderlyingWithdrawalId.isZero() && compareHexValues(reference, PaymentReference.announcedWithdrawal(agent.announcedUnderlyingWithdrawalId));
    }

    /**
     * @param agent instance of TrackedAgentState
     * @param transaction underlying transaction
     */
    addUnconfirmedTransaction(agent: TrackedAgentState, transaction: ITransaction) {
        getOrCreate(this.unconfirmedTransactions, agent.vaultAddress, () => new Map()).set(transaction.hash, transaction);
        logger.info(`Challenger ${this.address} stored unconfirmed underlying transaction ${transaction.hash}.`);
    }

    /**
     * @param agentVault agent's vault address
     * @param transactionHash underlying transaction hash
     */
    deleteUnconfirmedTransaction(agentVault: string, transactionHash: string) {
        const agentTransactions = this.unconfirmedTransactions.get(agentVault);
        if (agentTransactions) {
            agentTransactions.delete(transactionHash);
            if (agentTransactions.size === 0) this.unconfirmedTransactions.delete(agentVault);
            logger.info(`Challenger ${this.address} deleted unconfirmed underlying transaction ${transactionHash}.`);
        }
    }

    /**
     * @param scope
     * @param txHash underlying transaction hash
     * @param underlyingAddressString underlying address
     */
    async waitForDecreasingBalanceProof(scope: EventScope, txHash: string, underlyingAddressString: string) {
        await this.state.context.blockchainIndexer!.waitForUnderlyingTransactionFinalization(txHash);
        return await this.state.context.attestationProvider!.proveBalanceDecreasingTransaction(txHash, underlyingAddressString)
            .catch((e) => scope.exitOnExpectedError(e, [AttestationHelperError], ActorBaseKind.CHALLENGER, this.address));
    }

    /**
     * @param agentVault agent's vault address
     * @param body
     */
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

    /**
     * @returns underlying block height
     */
    async getLatestUnderlyingBlock(): Promise<number> {
        const blockHeight = await this.state.context.blockchainIndexer!.getBlockHeight();
        return blockHeight;
    }
}
