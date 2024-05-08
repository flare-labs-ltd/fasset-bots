import BN from "bn.js";
import { Agent } from "../fasset/Agent";
import { squashSpace } from "../utils/formatting";
import { NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentTokenBalances } from "./AgentTokenBalances";

export class AgentBotUnderlyingManagement {
    constructor(
        public agent: Agent,
        public notifier: AgentNotifier,
        public ownerUnderlyingAddress: string,
        public tokens: AgentTokenBalances,
    ) {}

    context = this.agent.context;

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished. If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     * @param agentVault agent's vault address
     */
    async checkUnderlyingBalance(): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking free underlying balance.`);
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        logger.info(`Agent's ${this.agent.vaultAddress} free underlying balance is ${freeUnderlyingBalance}.`);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee}.`);
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR), freeUnderlyingBalance);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} doesn't need underlying top up.`);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     * @param amount amount to transfer from owner's underlying address to agent's underlying address
     * @param agentVault agent's vault address
     * @param freeUnderlyingBalance agent's free underlying balance
     */
    async underlyingTopUp(amount: BN, freeUnderlyingBalance: BN): Promise<void> {
        try {
            const amountF = await this.tokens.underlying.format(amount);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to top up underlying address ${this.agent.underlyingAddress}
                from owner's underlying address ${this.ownerUnderlyingAddress}.`);
            const txHash = await this.agent.performTopupPayment(amount, this.ownerUnderlyingAddress);
            await this.agent.confirmTopupPayment(txHash);
            await this.notifier.sendLowUnderlyingAgentBalance(amountF);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} topped up underlying address ${this.agent.underlyingAddress} with amount
                ${amountF} from owner's underlying address ${this.ownerUnderlyingAddress} with txHash ${txHash}.`);
        } catch (error) {
            const freeBalanceF = await this.tokens.underlying.format(freeUnderlyingBalance);
            await this.notifier.sendLowUnderlyingAgentBalanceFailed(freeBalanceF);
            logger.error(squashSpace`Agent ${this.agent.vaultAddress} has low free underlying balance ${freeBalanceF} on underlying address
                ${this.agent.underlyingAddress} and could not be topped up from owner's underlying address ${this.ownerUnderlyingAddress}:`, error);
        }
        await this.checkForLowOwnerUnderlyingBalance();
    }

    async checkForLowOwnerUnderlyingBalance() {
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(this.ownerUnderlyingAddress);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        const expectedBalance = estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR);
        const balanceF = await this.tokens.underlying.format(ownerUnderlyingBalance);
        const expectedBalanceF = await this.tokens.underlying.format(expectedBalance);
        if (ownerUnderlyingBalance.lte(expectedBalance)) {
            await this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(this.ownerUnderlyingAddress, balanceF);
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has low balance
                ${balanceF} on underlying address ${this.ownerUnderlyingAddress}. Expected to have at least ${expectedBalanceF}.`);
        } else {
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has ${balanceF}
                on underlying address ${this.ownerUnderlyingAddress}.`);
        }
    }

}
