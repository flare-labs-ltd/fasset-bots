import BN from "bn.js";
import { BN_ZERO, ZERO_ADDRESS, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts } from "../utils/web3";
import { AgentBot } from "./AgentBot";
import { ClaimType } from "./AgentBotCollateralWithdrawal";

export class AgentBotClaims {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot
    ) {}

    agent = this.bot.agent;
    context = this.agent.context;

    /**
     * Checks if there are any claims for agent vault and collateral pool.
     */
    async checkForClaims(): Promise<void> {
        // delegation rewards
        await this.checkDelegationRewards(ClaimType.VAULT);
        await this.checkDelegationRewards(ClaimType.POOL);
        // airdrop distribution rewards
        await this.checkAirdropClaims(ClaimType.VAULT);
        await this.checkAirdropClaims(ClaimType.POOL);
        await this.checkTransferFeesClaims();
    }

    async checkDelegationRewards(type: ClaimType) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started checking for delegation rewards.`);
            const IRewardManager = artifacts.require("IRewardManager");
            const rewardManagerAddress = await this.context.addressUpdater.getContractAddress("RewardManager");
            const rewardManager = await IRewardManager.at(rewardManagerAddress);
            const addressToClaim = type === ClaimType.VAULT ? this.agent.vaultAddress : this.agent.collateralPool.address;
            const stateOfRewards = await rewardManager.getStateOfRewards(addressToClaim);
            let lastRewardEpoch = -1;
            for (let i = 0; i < stateOfRewards.length; i++) {
                // check if all rewards are initialised in the epoch
                let epochAmount = BN_ZERO;
                let allInitialised = true;
                for (let j = 0; j < stateOfRewards[i].length; j++) {
                    epochAmount = epochAmount.add(toBN(stateOfRewards[i][j].amount));
                    allInitialised &&= stateOfRewards[i][j].initialised;
                }
                if (!allInitialised) {
                    break;
                }
                if (epochAmount.gtn(0)) {
                    // as amount > 0 at least one record for epoch exists
                    // epochs are in ascending order, so we can always use the last one
                    lastRewardEpoch = toBN(stateOfRewards[i][0].rewardEpochId).toNumber();
                }
            }
            if (lastRewardEpoch >= 0) {
                logger.info(`Agent ${this.agent.vaultAddress} is claiming delegation rewards for ${addressToClaim} for epoch ${lastRewardEpoch}`);
                if (type === ClaimType.VAULT) {
                    await this.agent.agentVault.claimDelegationRewards(rewardManager.address, lastRewardEpoch, this.agent.owner.workAddress, [], { from: this.agent.owner.workAddress });
                } else {
                    await this.agent.collateralPool.claimDelegationRewards(rewardManager.address, lastRewardEpoch, [], { from: this.agent.owner.workAddress });
                }
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for delegation claims.`);
        } catch (error) {
            console.error(`Error handling delegation rewards for ${type} for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling delegation rewards for ${type}:`, error);
        }
    }

    async checkAirdropClaims(type: ClaimType) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started checking for airdrop distribution.`);
            const IDistributionToDelegators = artifacts.require("IDistributionToDelegators");
            const distributionToDelegatorsAddress = await this.context.addressUpdater.getContractAddress("DistributionToDelegators");
            if (distributionToDelegatorsAddress === ZERO_ADDRESS) return;   // DistributionToDelegators does not exist on Songbird/Coston
            const distributionToDelegators = await IDistributionToDelegators.at(distributionToDelegatorsAddress);
            const addressToClaim = type === ClaimType.VAULT ? this.agent.vaultAddress : this.agent.collateralPool.address;
            const { 1: endMonth } = await distributionToDelegators.getClaimableMonths({ from: addressToClaim });
            const claimable = await distributionToDelegators.getClaimableAmountOf(addressToClaim, endMonth);
            if (toBN(claimable).gtn(0)) {
                logger.info(`Agent ${this.agent.vaultAddress} is claiming airdrop distribution for ${addressToClaim} for month ${endMonth}.`);
                if (type === ClaimType.VAULT) {
                    await this.agent.agentVault.claimAirdropDistribution(distributionToDelegators.address, endMonth, this.agent.owner.workAddress, { from: this.agent.owner.workAddress });
                } else {
                    await this.agent.collateralPool.claimAirdropDistribution(distributionToDelegators.address, endMonth, { from: this.agent.owner.workAddress });
                }
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for airdrop distribution.`);
        } catch (error) {
            console.error(`Error handling airdrop distribution for ${type} for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling airdrop distribution for ${type}:`, error);
        }
    }

    async checkTransferFeesClaims() {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started checking for transfer fees.`);
            const { 0: firstUnclaimedEpoch, 1: count } = await this.agent.assetManager.agentUnclaimedTransferFeeEpochs(this.agent.vaultAddress);
            const maxEpochs = count.ltn(11) ? count : toBN(10);
            if (toBN(count).gtn(0)) {
                logger.info(`Agent ${this.agent.vaultAddress} is claiming transferFees for epochs ${String(firstUnclaimedEpoch)} - ${String(firstUnclaimedEpoch.add(maxEpochs).subn(1))}.`);
                await this.agent.assetManager.claimTransferFees(this.agent.vaultAddress, this.agent.owner.workAddress, maxEpochs, { from: this.agent.owner.workAddress });

            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for transfer fees.`);
        } catch (error) {
            console.error(`Error handling transfer fees for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling transfer fees:`, error);
        }
    }
}
