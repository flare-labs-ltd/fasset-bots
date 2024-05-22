import { EM } from "../config/orm";
import { AgentInfo } from "../fasset/AssetManagerTypes";
import { latestBlockTimestampBN, squashSpace } from "../utils";
import { BN_ZERO, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentBot, ClaimType } from "./AgentBot";

export class AgentBotClosing {
    constructor(
        public bot: AgentBot
    ) {}

    agent = this.bot.agent;
    notifier = this.bot.notifier;
    context = this.agent.context;

    async closingPhase(rootEm: EM) {
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        const agentInfo = await this.agent.getAgentInfoIfExists();
        if (agentInfo == null || !readAgentEnt.active) {
            return "DESTROYED";
        } else if (agentInfo.publiclyAvailable) {
            return "PUBLIC";
        } else if (readAgentEnt.waitingForDestructionCleanUp) {
            return "CLEANUP";
        } else if (toBN(readAgentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
            return "DESTROYING";
        }
    }

    async handleAgentCloseProcess(rootEm: EM) {
        const closingPhase = await this.closingPhase(rootEm);
        if (closingPhase === "CLEANUP") {
            logger.info(`Agent ${this.agent.vaultAddress} is performing cleanup.`);
            // withdraw and self close pool fees
            await this.withdrawPoolFees();
            // start or continue vault collateral withdrawal
            if (await this.waitingCollateralWithdrawal(rootEm)) {
                await this.performVaultCollateralWithdrawalWhenAllowed(rootEm);
            } else {
                await this.startVaultCollateralWithdrawal(rootEm);
            }
            // start or continue pool token redemption
            if (await this.waitingPoolTokenRedemption(rootEm)) {
                await this.performPoolTokenRedemptionWhenAllowed(rootEm);
            } else {
                await this.startPoolTokenRedemption(rootEm);
            }
            // start closing (when everybody else has redeemed)
            await this.startVaultDestroy(rootEm);
            // log current cleanup status
            await this.logClosingObstructions();
        } else if (closingPhase === "DESTROYING") {
            // destroy vault if possible
            await this.destroyVaultWhenAllowed(rootEm);
        }
    }

    async withdrawPoolFees() {
        const poolFeeBalance = await this.agent.poolFeeBalance();
        if (poolFeeBalance.gt(BN_ZERO)) {
            await this.agent.withdrawPoolFees(poolFeeBalance);
            await this.agent.selfClose(poolFeeBalance);
            logger.info(`Agent ${this.agent.vaultAddress} withdrew and self closed pool fees ${poolFeeBalance}.`);
        }
    }

    async waitingCollateralWithdrawal(rootEm: EM) {
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        return toBN(readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
    }

    async startVaultCollateralWithdrawal(rootEm: EM) {
        const agentInfo = await this.agent.getAgentInfo();
        const freeVaultCollateralBalance = toBN(agentInfo.freeVaultCollateralWei);
        if (freeVaultCollateralBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfo)) {
            // announce withdraw class 1
            const withdrawalAllowedAt = await this.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance)
            await this.bot.updateAgentEntity(rootEm, { destroyVaultCollateralWithdrawalAllowedAtTimestamp: withdrawalAllowedAt, destroyVaultCollateralWithdrawalAllowedAtAmount: freeVaultCollateralBalance.toString() });
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} announced vault collateral withdrawal of
                ${await this.bot.tokens.vaultCollateral.format(freeVaultCollateralBalance)} at ${readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp}.`);
        }
    }

    async performVaultCollateralWithdrawalWhenAllowed(rootEm: EM) {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for collateral withdrawal before destruction.`);
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        const withdrawAllowedAt = toBN(readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp);
        const withdrawAmount = toBN(readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount);
        const latestTimestamp = await latestBlockTimestampBN();
        const successOrExpired = await this.bot.withdrawCollateral(withdrawAllowedAt, withdrawAmount, latestTimestamp, ClaimType.VAULT);
        if (successOrExpired) {
            await this.bot.updateAgentEntity(rootEm, { destroyVaultCollateralWithdrawalAllowedAtTimestamp: BN_ZERO, destroyVaultCollateralWithdrawalAllowedAtAmount: "" });
        }
    }

    async waitingPoolTokenRedemption(rootEm: EM) {
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        return toBN(readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
    }

    async startPoolTokenRedemption(rootEm: EM) {
        const agentInfo = await this.agent.getAgentInfo();
        const poolTokenBalance = toBN(await this.agent.collateralPoolToken.balanceOf(this.agent.vaultAddress));
        if (poolTokenBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfo)) {
            // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
            const redemptionAllowedAt = await this.agent.announcePoolTokenRedemption(poolTokenBalance);
            await this.bot.updateAgentEntity(rootEm, { destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp: redemptionAllowedAt, destroyPoolTokenRedemptionWithdrawalAllowedAtAmount: poolTokenBalance.toString() });
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} announced pool token redemption of
                ${await this.bot.tokens.poolToken.format(poolTokenBalance)} at ${readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp}.`);
        }
    }

    async performPoolTokenRedemptionWhenAllowed(rootEm: EM) {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for pool token redemption before destruction.`);
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        const withdrawAllowedAt = toBN(readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp);
        const withdrawAmount = toBN(readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount);
        const latestTimestamp = await latestBlockTimestampBN();
        const successOrExpired = await this.bot.withdrawCollateral(withdrawAllowedAt, withdrawAmount, latestTimestamp, ClaimType.POOL);
        if (successOrExpired) {
            await this.bot.updateAgentEntity(rootEm, { destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp: BN_ZERO, destroyPoolTokenRedemptionWithdrawalAllowedAtAmount: "" });
        }
    }

    async startVaultDestroy(rootEm: EM) {
        const agentInfo = await this.agent.getAgentInfo();
        const totalPoolTokens = toBN(await this.agent.collateralPoolToken.totalSupply());
        const totalVaultCollateral = toBN(agentInfo.totalVaultCollateralWei);
        const everythingClean = totalPoolTokens.eq(BN_ZERO) && totalVaultCollateral.eq(BN_ZERO) && this.hasNoBackedFAssets(agentInfo);
        if (everythingClean) {
            const destroyAllowedAt = await this.agent.announceDestroy();
            await this.bot.updateAgentEntity(rootEm, { waitingForDestructionTimestamp: destroyAllowedAt, waitingForDestructionCleanUp: false });
            await this.notifier.sendAgentAnnounceDestroy();
            logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
        }
    }

    async destroyVaultWhenAllowed(rootEm: EM) {
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        if (toBN(readAgentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
            logger.info(`Agent ${this.agent.vaultAddress} is waiting for destruction.`);
            // agent waiting for destruction
            const latestTimestamp = await latestBlockTimestampBN();
            if (toBN(readAgentEnt.waitingForDestructionTimestamp).lte(latestTimestamp)) {
                // agent can be destroyed
                await this.agent.destroy();
                await this.handleAgentDestroyed(rootEm, { waitingForDestructionTimestamp: BN_ZERO });
            } else {
                const allowedIn = toBN(readAgentEnt.waitingForDestructionTimestamp).sub(latestTimestamp);
                logger.info(`Agent ${this.agent.vaultAddress} cannot be destroyed yet. Allowed in ${allowedIn} seconds.`);
            }
        }
    }

    async handleAgentDestroyed(rootEm: EM, fields_to_update: { [key: string]: any } = {}) {
        await this.bot.updateAgentEntity(rootEm, { active: false, ...fields_to_update });
        await this.notifier.sendAgentDestroyed();
        logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
    }

    async logClosingObstructions() {
        const agentInfo = await this.agent.getAgentInfo();
        if (toBN(agentInfo.mintedUBA).gt(BN_ZERO)) {
            logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Agent is still backing FAssets.`);
        }
        if (toBN(agentInfo.redeemingUBA).gt(BN_ZERO) || toBN(agentInfo.poolRedeemingUBA).gt(BN_ZERO)) {
            logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Agent is still redeeming FAssets.`);
        }
        if (toBN(agentInfo.reservedUBA).gt(BN_ZERO)) {
            logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Agent has some locked collateral by collateral reservation.`);
        }
        const totalPoolTokens = toBN(await this.agent.collateralPoolToken.totalSupply());
        if (toBN(totalPoolTokens).gt(BN_ZERO)) {
            logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Total supply of collateral pool tokens is not 0.`);
        }
    }

    hasNoBackedFAssets(agentInfo: AgentInfo) {
        return toBN(agentInfo.mintedUBA).eq(BN_ZERO) && toBN(agentInfo.redeemingUBA).eq(BN_ZERO) &&
            toBN(agentInfo.reservedUBA).eq(BN_ZERO) && toBN(agentInfo.poolRedeemingUBA).eq(BN_ZERO);
    }
}
