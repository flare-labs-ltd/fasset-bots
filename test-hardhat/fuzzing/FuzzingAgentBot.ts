import { AgentBot } from "../../src/actors/AgentBot";
import { BotCliCommands } from "../../src/actors/AgentBotCliCommands";
import { EM } from "../../src/config/orm";
import {  AgentRedemption, AgentRedemptionState } from "../../src/entities/agent";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { MockChain } from "../../src/mock/MockChain";
import { EventScope } from "../../src/utils/events/ScopedEvents";
import { MAX_BIPS, checkedCast, toBN } from "../../src/utils/helpers";
import { coinFlip, formatBN, getLotSize, randomBN, randomChoice, randomInt } from "../test-utils/fuzzing-utils";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingAgentBot {
    constructor(
        public agentBot: AgentBot,
        public runner: FuzzingRunner,
        public rootEm: EM,
        public ownerUnderlyingAddress: string,
        public botCliCommands: BotCliCommands
    ) {
    }

    async selfMint(scope: EventScope, chain: MockChain) {
        const agent = this.agentBot.agent;   // save in case it is destroyed and re-created
        const agentInfo = await this.agentBot.context.assetManager.getAgentInfo(agent.vaultAddress);
        const lotSize = getLotSize(await this.agentBot.context.assetManager.getSettings());
        const lots = randomInt(Number(agentInfo.freeCollateralLots));
        if (this.runner.avoidErrors && lots === 0) return;
        const mintedAmountUBA = toBN(lots).mul(lotSize);
        const poolFeeUBA = mintedAmountUBA.mul(toBN(agentInfo.feeBIPS)).divn(MAX_BIPS).mul(toBN(agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
        const mintingUBA = mintedAmountUBA.add(poolFeeUBA);
        // perform payment
        checkedCast(chain, MockChain).mint(this.ownerUnderlyingAddress, mintingUBA);
        const txHash = await agent.wallet.addTransaction(this.ownerUnderlyingAddress, agent.underlyingAddress, mintingUBA, PaymentReference.selfMint(agent.vaultAddress));
        // wait for finalization
        await this.agentBot.context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash); //TODO - check if it is ok
        // execute
        const proof = await this.agentBot.context.attestationProvider.provePayment(txHash, null, agent.underlyingAddress);
        await this.agentBot.context.assetManager.selfMint(proof, agent.vaultAddress, lots, { from: this.agentBot.agent.ownerAddress })
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'self-mint payment too small',
                'self-mint invalid agent status', 'invalid self-mint reference', 'self-mint payment too old']));
        // 'self-mint payment too small' can happen after lot size change
        // 'invalid self-mint reference' can happen if agent is destroyed and re-created
        // 'self-mint payment too old' can happen when agent self-mints quickly after being created (typically when agent is re-created) and there is time skew
        // const args = requiredEventArgs(res, 'MintingExecuted');
        // TODO: accounting?
        this.runner.comment(`self minted successfully`, `${this.runner.eventFormatter.formatAddress(this.agentBot.agent.vaultAddress)}`);
    }

    async selfClose(scope: EventScope) {
        const agentInfo = await this.agentBot.agent.getAgentInfo();
        if (Number(agentInfo.status) !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const mintedAssets = toBN(agentInfo.mintedUBA);
        if (mintedAssets.isZero()) return;
        const ownersAssets = await this.agentBot.context.fAsset.balanceOf(this.agentBot.agent.ownerAddress);
        if (ownersAssets.isZero()) return;
        // // TODO: buy fassets
        const amountUBA = randomBN(ownersAssets);
        if (this.runner.avoidErrors && amountUBA.isZero()) return;
        await this.agentBot.agent.selfClose(amountUBA).catch(e => scope.exitOnExpectedError(e, ['Burn too big for owner', 'redeem 0 lots']));
        this.runner.comment(`self closed successfully`, `${this.runner.eventFormatter.formatAddress(this.agentBot.agent.vaultAddress)}`);
    }

    async convertDustToTicket(scope: EventScope): Promise<void> {
        const agent = this.agentBot.agent;   // save in case agent is destroyed and re-created
        await this.agentBot.context.assetManager.convertDustToTicket(agent.vaultAddress)
            .catch(e => scope.exitOnExpectedError(e, []));
            this.runner.comment(`converted dust to tickets successfully`, `${this.runner.eventFormatter.formatAddress(this.agentBot.agent.vaultAddress)}`);
    }


    async makeIllegalTransaction(): Promise<void> {
        const agent = this.agentBot.agent;   // save in case it is destroyed and re-created
        const balance = await this.agentBot.context.wallet.getBalance(agent.underlyingAddress);
        if (balance.isZero()) return;
        const amount = randomBN(balance);
        this.runner.comment(`is making illegal transaction of ${formatBN(amount)} from ${agent.underlyingAddress}`, `${this.runner.eventFormatter.formatAddress(agent.vaultAddress)}`);
        await agent.wallet.addTransaction(agent.underlyingAddress, this.ownerUnderlyingAddress, amount, null);
    }

    async makeDoublePayment(): Promise<void> {
        const agent = this.agentBot.agent;   // save in case it is destroyed and re-created
        const redemptions = await this.openRedemptions();
        if (redemptions.length === 0) return;
        const redemption = randomChoice(redemptions);
        const amount = redemption.valueUBA;
        this.runner.comment(`is making double payment of ${formatBN(amount)} from ${agent.underlyingAddress}`, `${this.runner.eventFormatter.formatAddress(agent.vaultAddress)}`);

        await agent.wallet.addTransaction(agent.underlyingAddress, this.ownerUnderlyingAddress, amount, redemption.paymentReference);
    }

    async openRedemptions(): Promise<AgentRedemption[]> {
        const query = this.rootEm.createQueryBuilder(AgentRedemption);
        return await query.where({ agentAddress: this.agentBot.agent.vaultAddress })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .getResultList();
    }

    async announcedUnderlyingWithdrawal() {
        const agentInfo = await this.agentBot.agent.getAgentInfo();
        const agentStatus = Number(agentInfo.status);
        if (agentStatus !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const amount = randomBN(toBN(agentInfo.freeUnderlyingBalanceUBA));
        if (amount.isZero()) return;
        // announce
        const reference = await this.botCliCommands.announceUnderlyingWithdrawal(this.agentBot.agent.vaultAddress);
        if (coinFlip(0.8) && reference) {
            const txHash = await this.botCliCommands.performUnderlyingWithdrawal(this.agentBot.agent.vaultAddress, amount.toString(), this.ownerUnderlyingAddress, reference);
            await this.botCliCommands.confirmUnderlyingWithdrawal(this.agentBot.agent.vaultAddress, txHash);
        } else if(reference) {
            // cancel withdrawal
            await this.botCliCommands.cancelUnderlyingWithdrawal(this.agentBot.agent.vaultAddress);
        }
    }

}


