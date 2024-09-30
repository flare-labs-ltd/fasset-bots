import BN from "bn.js";
import { EM } from "../config/orm";
import { BN_ZERO, errorIncluded, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentBot } from "./AgentBot";

export enum ClaimType {
    POOL = "POOL",
    VAULT = "VAULT"
}

export class AgentBotCollateralWithdrawal {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot
    ) {}

    agent = this.bot.agent;
    notifier = this.bot.notifier;
    context = this.agent.context;

    async handleWaitForCollateralWithdrawal(rootEm: EM) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            if (toBN(readAgentEnt.withdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                const allowedAt = toBN(readAgentEnt.withdrawalAllowedAtTimestamp);
                const amount = toBN(readAgentEnt.withdrawalAllowedAtAmount);
                const successOrExpired = await this.withdrawCollateral(allowedAt, amount, ClaimType.VAULT);
                if (successOrExpired) {
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
                        agentEnt.withdrawalAllowedAtAmount = "";
                    });
                }
            }
        } catch (error) {
            console.error(`Error while handling wait for collateral withdrawal for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling wait for collateral withdrawal during handleTimelockedProcesses:`, error);
        }
    }

    async handleWaitForPoolTokenRedemption(rootEm: EM) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            if (toBN(readAgentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                const allowedAt = toBN(readAgentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp);
                const amount = toBN(readAgentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount);
                const successOrExpired = await this.withdrawCollateral(allowedAt, amount, ClaimType.POOL);
                if (successOrExpired) {
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
                    });
                }
            }
        } catch (error) {
            console.error(`Error while handling wait for pool token redemption for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling wait for pool token redemption during handleTimelockedProcesses:`, error);
        }
    }

    /**
     * AgentBot tries to withdraw vault collateral or redeem pool tokens
     * @param withdrawValidAt
     * @param withdrawAmount
     * @param latestTimestamp
     * @param type
     * @returns true if withdraw successful or time expired
     */
    async withdrawCollateral(withdrawValidAt: BN, withdrawAmount: BN, type: ClaimType): Promise<boolean> {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting to withdraw ${type} collateral.`);
        // agent waiting for pool token redemption
        const latestTimestamp = await latestBlockTimestampBN();
        if (toBN(withdrawValidAt).lte(latestTimestamp)) {
            // agent can withdraw vault collateral
            const token = type === ClaimType.VAULT ? this.bot.tokens.vaultCollateral : this.bot.tokens.poolCollateral;
            try {
                if (type === ClaimType.VAULT) {
                    await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                        await this.agent.withdrawVaultCollateral(withdrawAmount);
                    });
                    await this.notifier.sendWithdrawVaultCollateral(await token.format(withdrawAmount));
                } else {
                    await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                        await this.agent.redeemCollateralPoolTokens(withdrawAmount);
                    });
                    await this.notifier.sendRedeemCollateralPoolTokens(await token.format(withdrawAmount));
                }
                logger.info(`Agent ${this.agent.vaultAddress} withdrew ${type} collateral ${withdrawAmount}.`);
                return true;
            } catch (error) {
                if (errorIncluded(error, ["withdrawal: too late", "withdrawal: CR too low"])) {
                    await this.notifier.sendAgentCannotWithdrawCollateral(await token.format(withdrawAmount), type);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while withdrawing ${type} collateral:`, error);
            }
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot withdraw ${type} collateral. Allowed at ${withdrawValidAt}. Current ${latestTimestamp}.`);
        }
        return false;
    }
}
