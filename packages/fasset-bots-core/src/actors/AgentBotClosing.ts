import { AgentEntity } from "../entities/agent";
import { AgentInfo } from "../fasset/AssetManagerTypes";
import { latestBlockTimestampBN, squashSpace } from "../utils";
import { BN_ZERO, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentBot, ClaimType } from "./AgentBot";

export class AgentBotClosing {
    constructor(
        public bot: AgentBot,
        public agentEnt: AgentEntity,
    ) {}

    agent = this.bot.agent;
    notifier = this.bot.notifier;
    context = this.agent.context;

    async closingPhase() {
        const agentInfo = await this.agent.getAgentInfoIfExists();
        if (agentInfo == null || !this.agentEnt.active) {
            return "DESTROYED";
        } else if (agentInfo.publiclyAvailable) {
            return "PUBLIC";
        } else if (this.agentEnt.waitingForDestructionCleanUp) {
            return "CLEANUP";
        } else if (toBN(this.agentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
            return "DESTROYING";
        }
    }

    async handleAgentCloseProcess() {
        const closingPhase = await this.closingPhase();
        if (closingPhase === "CLEANUP") {
            logger.info(`Agent ${this.agent.vaultAddress} is performing cleanup.`);
            // withdraw and self close pool fees
            await this.withdrawPoolFees();
            // start or continue vault collateral withdrawal
            if (this.waitingCollateralWithdrawal()) {
                await this.performVaultCollateralWithdrawalWhenAllowed();
            } else {
                await this.startVaultCollateralWithdrawal();
            }
            // start or continue pool token redemption
            if (this.waitingPoolTokenRedemption()) {
                await this.performPoolTokenRedemptionWhenAllowed();
            } else {
                await this.startPoolTokenRedemption();
            }
            // start closing (when everybody else has redeemed)
            await this.startVaultDestroy();
            // log current cleanup status
            await this.logClosingObstructions();
        } else if (closingPhase === "DESTROYING") {
            // destroy vault if possible
            await this.destroyVaultWhenAllowed();
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

    waitingCollateralWithdrawal() {
        return toBN(this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
    }

    async startVaultCollateralWithdrawal() {
        const agentInfo = await this.agent.getAgentInfo();
        const freeVaultCollateralBalance = toBN(agentInfo.freeVaultCollateralWei);
        if (freeVaultCollateralBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfo)) {
            // announce withdraw class 1
            this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = await this.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance);
            this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = freeVaultCollateralBalance.toString();
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} announced vault collateral withdrawal of
                ${this.bot.tokens.vaultCollateral.format(freeVaultCollateralBalance)} at ${this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp}.`);
        }
    }

    async performVaultCollateralWithdrawalWhenAllowed() {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for collateral withdrawal before destruction.`);
        const withdrawAllowedAt = toBN(this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp);
        const withdrawAmount = toBN(this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount);
        const latestTimestamp = await latestBlockTimestampBN();
        const successOrExpired = await this.bot.withdrawCollateral(withdrawAllowedAt, withdrawAmount, latestTimestamp, ClaimType.VAULT);
        if (successOrExpired) {
            this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = BN_ZERO;
            this.agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = "";
        }
    }

    waitingPoolTokenRedemption() {
        return toBN(this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
    }

    async startPoolTokenRedemption() {
        const agentInfo = await this.agent.getAgentInfo();
        const poolTokenBalance = toBN(await this.agent.collateralPoolToken.balanceOf(this.agent.vaultAddress));
        if (poolTokenBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfo)) {
            // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
            this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = await this.agent.announcePoolTokenRedemption(poolTokenBalance);
            this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = poolTokenBalance.toString();
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} announced pool token redemption of
                ${this.bot.tokens.poolToken.format(poolTokenBalance)} at ${this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp}.`);
        }
    }

    async performPoolTokenRedemptionWhenAllowed() {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for pool token redemption before destruction.`);
        const withdrawAllowedAt = toBN(this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp);
        const withdrawAmount = toBN(this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount);
        const latestTimestamp = await latestBlockTimestampBN();
        const successOrExpired = await this.bot.withdrawCollateral(withdrawAllowedAt, withdrawAmount, latestTimestamp, ClaimType.POOL);
        if (successOrExpired) {
            this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
            this.agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = "";
        }
    }

    async startVaultDestroy() {
        const agentInfo = await this.agent.getAgentInfo();
        const totalPoolTokens = toBN(await this.agent.collateralPoolToken.totalSupply());
        const totalVaultCollateral = toBN(agentInfo.totalVaultCollateralWei);
        const everythingClean = totalPoolTokens.eq(BN_ZERO) && totalVaultCollateral.eq(BN_ZERO) && this.hasNoBackedFAssets(agentInfo);
        if (everythingClean) {
            const destroyAllowedAt = await this.agent.announceDestroy();
            this.agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
            this.agentEnt.waitingForDestructionCleanUp = false;
            await this.notifier.sendAgentAnnounceDestroy();
            logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
        }
    }

    async destroyVaultWhenAllowed() {
        if (toBN(this.agentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
            logger.info(`Agent ${this.agent.vaultAddress} is waiting for destruction.`);
            // agent waiting for destruction
            const latestTimestamp = await latestBlockTimestampBN();
            if (toBN(this.agentEnt.waitingForDestructionTimestamp).lte(latestTimestamp)) {
                // agent can be destroyed
                await this.agent.destroy();
                this.agentEnt.waitingForDestructionTimestamp = BN_ZERO;
                await this.handleAgentDestroyed();
            } else {
                const allowedIn = toBN(this.agentEnt.waitingForDestructionTimestamp).sub(latestTimestamp);
                logger.info(`Agent ${this.agent.vaultAddress} cannot be destroyed yet. Allowed in ${allowedIn} seconds.`);
            }
        }
    }

    async handleAgentDestroyed() {
        this.agentEnt.active = false;
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
