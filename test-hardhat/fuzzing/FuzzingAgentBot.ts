import { AgentBot } from "../../src/actors/AgentBot";
import { EM } from "../../src/config/orm";
import {  AgentRedemption, AgentRedemptionState } from "../../src/entities/agent";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { MockChain } from "../../src/mock/MockChain";
import { EventScope } from "../../src/utils/events/ScopedEvents";
import { MAX_BIPS, checkedCast, requireEnv, toBN } from "../../src/utils/helpers";
import { coinFlip, formatBN, getLotSize, randomBN, randomChoice, randomInt } from "../test-utils/fuzzing-utils";
import { FuzzingRunner } from "./FuzzingRunner";

const ownerUnderlyingAddress = requireEnv('OWNER_UNDERLYING_ADDRESS');

export class FuzzingAgentBot {
    constructor(
        public agentBot: AgentBot,
        public runner: FuzzingRunner,
        public rootEm: EM
    ) {
    }

    async selfMint(scope: EventScope) {
        const agent = this.agentBot.agent;   // save in case it is destroyed and re-created
        const agentInfo = await this.agentBot.context.assetManager.getAgentInfo(agent.vaultAddress);
        const lotSize = getLotSize(await this.agentBot.context.assetManager.getSettings());
        const lots = randomInt(Number(agentInfo.freeCollateralLots));
        if (this.runner.avoidErrors && lots === 0) return;
        const mintedAmountUBA = toBN(lots).mul(lotSize);
        const poolFeeUBA = mintedAmountUBA.mul(toBN(agentInfo.feeBIPS)).divn(MAX_BIPS).mul(toBN(agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
        const mintingUBA = mintedAmountUBA.add(poolFeeUBA);
        // perform payment
        checkedCast(this.agentBot.context.chain, MockChain).mint(ownerUnderlyingAddress, mintingUBA);
        const txHash = await agent.wallet.addTransaction(ownerUnderlyingAddress, agent.underlyingAddress, mintingUBA, PaymentReference.selfMint(agent.vaultAddress));
        // wait for finalization
        await this.agentBot.context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash); //TODO - check if it is ok
        // execute
        const proof = await this.agentBot.context.attestationProvider.provePayment(txHash, null, agent.underlyingAddress);
        const res = await this.agentBot.context.assetManager.selfMint(proof, agent.vaultAddress, lots, { from: this.agentBot.agent.ownerAddress })
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'self-mint payment too small',
                'self-mint invalid agent status', 'invalid self-mint reference', 'self-mint payment too old']));
        // 'self-mint payment too small' can happen after lot size change
        // 'invalid self-mint reference' can happen if agent is destroyed and re-created
        // 'self-mint payment too old' can happen when agent self-mints quickly after being created (typically when agent is re-created) and there is time skew
        // const args = requiredEventArgs(res, 'MintingExecuted');
        // TODO: accounting?
    }

    async selfClose(scope: EventScope) {
        const agent = this.agentBot.agent;   // save in case agent is destroyed and re-created
        const agentInfo = await this.agentBot.agent.getAgentInfo();
        if (Number(agentInfo.status) !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const mintedAssets = toBN(agentInfo.mintedUBA);
        if (mintedAssets.isZero()) return;
        const ownersAssets = await this.agentBot.context.fAsset.balanceOf(this.agentBot.agent.ownerAddress);
        if (ownersAssets.isZero()) return;
        // TODO: buy fassets
        const amountUBA = randomBN(ownersAssets);
        if (this.runner.avoidErrors && amountUBA.isZero()) return;
        await agent.selfClose(amountUBA)
            .catch(e => scope.exitOnExpectedError(e, ['Burn too big for owner', 'redeem 0 lots']));
    }

    async convertDustToTicket(scope: EventScope): Promise<void> {
        const agent = this.agentBot.agent;   // save in case agent is destroyed and re-created
        await this.agentBot.context.assetManager.convertDustToTicket(agent.vaultAddress)
            .catch(e => scope.exitOnExpectedError(e, []));
    }


    async makeIllegalTransaction(): Promise<void> {
        const agent = this.agentBot.agent;   // save in case it is destroyed and re-created
        const balance = await this.agentBot.context.chain.getBalance(agent.underlyingAddress);
        if (balance.isZero()) return;
        const amount = randomBN(balance);
        this.runner.comment(`Making illegal transaction of ${formatBN(amount)} from ${agent.underlyingAddress}`);
        await agent.wallet.addTransaction(agent.underlyingAddress, ownerUnderlyingAddress, amount, null);
    }

    async makeDoublePayment(): Promise<void> {
        const agent = this.agentBot.agent;   // save in case it is destroyed and re-created
        const redemptions = await this.openRedemptions();
        if (redemptions.length === 0) return;
        const redemption = randomChoice(redemptions);
        const amount = redemption.valueUBA;
        this.runner.comment(`Making double payment of ${formatBN(amount)} from ${agent.underlyingAddress}`);

        await agent.wallet.addTransaction(agent.underlyingAddress, ownerUnderlyingAddress, amount, redemption.paymentReference);
    }

    async openRedemptions(): Promise<AgentRedemption[]> {
        const query = this.rootEm.createQueryBuilder(AgentRedemption);
        return await query.where({ agentAddress: this.agentBot.agent.vaultAddress })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .getResultList();
    }


    async announcedUnderlyingWithdrawal(scope: EventScope) {
        const agent = this.agentBot.agent;   // save in case agent is destroyed and re-created
        const agentInfo = await this.agentBot.agent.getAgentInfo();
        const agentStatus = Number(agentInfo.status);
        if (agentStatus !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const amount = randomBN(agentInfo.freeUnderlyingBalanceUBA);
        if (amount.isZero()) return;
        // announce
        const announcement = await agent.announceUnderlyingWithdrawal()
            .catch(e => scope.exitOnExpectedError(e, ['announced underlying withdrawal active']));
        if (coinFlip(0.8)) {
            // perform withdrawal
            const txHash = await agent.performUnderlyingWithdrawal(announcement.paymentReference, amount, ownerUnderlyingAddress)
                .catch(e => scope.exitOnExpectedError(e, []));
            // wait for finalization
            await this.agentBot.context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash);
            // wait
            // confirm
            await agent.confirmUnderlyingWithdrawal(txHash)
                .catch(e => scope.exitOnExpectedError(e, []));
        } else {
            // cancel withdrawal
            await agent.cancelUnderlyingWithdrawal()
                .catch(e => scope.exitOnExpectedError(e, []));
        }
    }

}


