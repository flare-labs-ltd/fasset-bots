import { EM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { AgentInfo } from "../fasset/AssetManagerTypes";
import { TokenBalances, latestBlockTimestampBN, squashSpace } from "../utils";
import { BN_ZERO, minBN, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentBot } from "./AgentBot";
import { ClaimType } from "./AgentBotCollateralWithdrawal";

export class AgentBotClosing {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot
    ) {}

    agent = this.bot.agent;
    notifier = this.bot.notifier;
    context = this.agent.context;

    async closingPhase(readAgentEnt: AgentEntity) {
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
        try {
            const readAgentEntAtBeginning = await this.bot.fetchAgentEntity(rootEm);
            const closingPhase = await this.closingPhase(readAgentEntAtBeginning);
            if (closingPhase === "CLEANUP") {
                logger.info(`Agent ${this.agent.vaultAddress} is performing cleanup.`);
                // withdraw pool fees
                await this.withdrawPoolFees();
                // self close minted fassets with fassets on agent's address
                await this.selfCloseFAssets();
                // start or continue vault collateral withdrawal
                await this.startOrWithdrawVaultCollateral(rootEm);
                // start or continue pool token redemption
                await this.startOrRedeemPoolTokens(rootEm);
                // start closing (when everybody else has redeemed)
                await this.startVaultDestroy(rootEm);
                // log current cleanup status
                await this.logClosingObstructions();
            } else if (closingPhase === "DESTROYING") {
                // destroy vault if possible
                await this.destroyVaultWhenAllowed(rootEm);
            }
        } catch (error) {
            console.error(`Error while handling agent close process for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling agent close process:`, error);
        }
    }

    async startOrWithdrawVaultCollateral(rootEm: EM) {
        if (this.bot.stopRequested()) return;
        try {
            const readAgentEntAtWithdrawal = await this.bot.fetchAgentEntity(rootEm);
            if (this.waitingCollateralWithdrawal(readAgentEntAtWithdrawal)) {
                await this.performVaultCollateralWithdrawalWhenAllowed(rootEm);
            } else {
                await this.startVaultCollateralWithdrawal(rootEm);
            }
        } catch (error) {
            console.error(`Error while starting or withdrawing vault collateral ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while starting or withdrawing vault collateral:`, error);
        }
    }

    async startOrRedeemPoolTokens(rootEm: EM) {
        if (this.bot.stopRequested()) return;
        try {
            const readAgentEntAtPTRedemption = await this.bot.fetchAgentEntity(rootEm);
            if (this.waitingPoolTokenRedemption(readAgentEntAtPTRedemption)) {
                await this.performPoolTokenRedemptionWhenAllowed(rootEm);
            } else {
                await this.startPoolTokenRedemption(rootEm);
            }
        } catch (error) {
            console.error(`Error while starting or redeeming pool tokens ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while starting or redeeming pool tokens:`, error);
        }
    }

    async withdrawPoolFees() {
        if (this.bot.stopRequested()) return;
        try {
            const poolFeeBalance = await this.agent.poolFeeBalance();
            if (poolFeeBalance.gt(BN_ZERO)) {
                await this.bot.locks.nativeChainLock.lockAndRun(async () => {
                    await this.agent.withdrawPoolFees(poolFeeBalance);
                });
                const br = await TokenBalances.fasset(this.context);
                logger.info(`Agent ${this.agent.vaultAddress} withdrew and self closed pool fees ${br.format(poolFeeBalance)}.`);
            }
        } catch (error) {
            console.error(`Error while withdrawing pool fees for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while withdrawing pool fees:`, error);
        }
    }

    async selfCloseFAssets() {
        if (this.bot.stopRequested()) return;
        try {
            const br = await TokenBalances.fasset(this.context);
            const ownerFAssetBalance = await br.balance(this.bot.owner.workAddress);
            const agentInfo = await this.agent.getAgentInfo();
            const minted = toBN(agentInfo.mintedUBA);
            const closeAmount = minBN(ownerFAssetBalance, minted);
            if (closeAmount.gt(BN_ZERO)) {
                await this.bot.locks.nativeChainLock.lockAndRun(async () => {
                    await this.agent.selfClose(closeAmount);
                });
                const remaining = minted.sub(closeAmount);
                logger.info(`Agent ${this.agent.vaultAddress} self closed fassets ${br.format(closeAmount)}, remains minted ${br.format(remaining)}`);
            }
        } catch (error) {
            console.error(`Error while self closing ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error self closing:`, error);
        }
    }

    waitingCollateralWithdrawal(readAgentEnt: AgentEntity) {
        return toBN(readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
    }

    async startVaultCollateralWithdrawal(rootEm: EM) {
        const agentInfo = await this.agent.getAgentInfo();
        const freeVaultCollateralBalance = toBN(agentInfo.freeVaultCollateralWei);
        if (freeVaultCollateralBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfo)) {
            // announce withdraw class 1
            const withdrawalAllowedAt = await this.bot.locks.nativeChainLock.lockAndRun(async () => {
                return await this.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance)
            });
            await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
                agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = freeVaultCollateralBalance.toString();
            });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} announced vault collateral withdrawal of
                ${await this.bot.tokens.vaultCollateral.format(freeVaultCollateralBalance)} at ${withdrawalAllowedAt}.`);
        }
    }

    async performVaultCollateralWithdrawalWhenAllowed(rootEm: EM) {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for collateral withdrawal before destruction.`);
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        const withdrawAllowedAt = toBN(readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp);
        const withdrawAmount = toBN(readAgentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount);
        const successOrExpired = await this.bot.collateralWithdrawal.withdrawCollateral(withdrawAllowedAt, withdrawAmount, ClaimType.VAULT);
        if (successOrExpired) {
            await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = BN_ZERO;
                agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = "";
            });
        }
    }

    waitingPoolTokenRedemption(readAgentEnt: AgentEntity) {
        return toBN(readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
    }

    async startPoolTokenRedemption(rootEm: EM) {
        const agentInfo = await this.agent.getAgentInfo();
        const poolTokenBalance = toBN(await this.agent.collateralPoolToken.balanceOf(this.agent.vaultAddress));
        if (poolTokenBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfo)) {
            // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
            const redemptionAllowedAt = await this.bot.locks.nativeChainLock.lockAndRun(async () => {
                return await this.agent.announcePoolTokenRedemption(poolTokenBalance);
            });
            await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = redemptionAllowedAt;
                agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = poolTokenBalance.toString();
            });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} announced pool token redemption of
                ${await this.bot.tokens.poolToken.format(poolTokenBalance)} at ${redemptionAllowedAt}.`);
        }
    }

    async performPoolTokenRedemptionWhenAllowed(rootEm: EM) {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for pool token redemption before destruction.`);
        const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
        const withdrawAllowedAt = toBN(readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp);
        const withdrawAmount = toBN(readAgentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount);
        const successOrExpired = await this.bot.collateralWithdrawal.withdrawCollateral(withdrawAllowedAt, withdrawAmount, ClaimType.POOL);
        if (successOrExpired) {
            await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = "";
            });
        }
    }

    async startVaultDestroy(rootEm: EM) {
        if (this.bot.stopRequested()) return;
        try {
            const agentInfo = await this.agent.getAgentInfo();
            const totalPoolTokens = toBN(await this.agent.collateralPoolToken.totalSupply());
            const totalVaultCollateral = toBN(agentInfo.totalVaultCollateralWei);
            const everythingClean = totalPoolTokens.eq(BN_ZERO) && totalVaultCollateral.eq(BN_ZERO) && this.hasNoBackedFAssets(agentInfo);
            if (everythingClean) {
                const destroyAllowedAt = await this.bot.locks.nativeChainLock.lockAndRun(async () => {
                    return await this.agent.announceDestroy();
                });
                await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                    agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
                    agentEnt.waitingForDestructionCleanUp = false;
                });
                await this.notifier.sendAgentAnnounceDestroy();
                logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
            }
        } catch (error) {
            console.error(`Error while handling start vault destruction for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling start vault destruction:`, error);
        }
    }

    async destroyVaultWhenAllowed(rootEm: EM) {
        if (this.bot.stopRequested()) return;
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            if (toBN(readAgentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for destruction.`);
                // agent waiting for destruction
                const latestTimestamp = await latestBlockTimestampBN();
                if (toBN(readAgentEnt.waitingForDestructionTimestamp).lte(latestTimestamp)) {
                    // agent can be destroyed
                    await this.bot.locks.nativeChainLock.lockAndRun(async () => {
                        await this.agent.destroy();
                    });
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.waitingForDestructionTimestamp = BN_ZERO;
                    });
                    await this.handleAgentDestroyed(rootEm);
                } else {
                    const allowedIn = toBN(readAgentEnt.waitingForDestructionTimestamp).sub(latestTimestamp);
                    logger.info(`Agent ${this.agent.vaultAddress} cannot be destroyed yet. Allowed in ${allowedIn} seconds.`);
                }
            }
        } catch (error) {
            console.error(`Error while destroying vault for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while destroying vault:`, error);
        }
    }

    /**
     * Marks stored AgentBot in persistent state as inactive after event 'AgentDestroyed' is received.
     * @param em entity manager
     */
    async handleAgentDestroyed(rootEm: EM) {
        await this.bot.locks.underlyingLock.lockAndRun(async () => {
            await this.agent.emptyAgentUnderlying(this.bot.ownerUnderlyingAddress);
        });
        await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
            agentEnt.active = false;
        });
        await this.notifier.sendAgentDestroyed();
        // stop the running agent loop
        this.bot.requestStop();
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
