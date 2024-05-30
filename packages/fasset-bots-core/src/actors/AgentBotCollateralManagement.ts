import BN from "bn.js";
import { AgentBotSettings } from "../config";
import { Agent } from "../fasset/Agent";
import { AgentInfo, AgentStatus, CollateralClass } from "../fasset/AssetManagerTypes";
import { CollateralPrice } from "../state/CollateralPrice";
import { BN_ZERO, MAX_BIPS, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentTokenBalances } from "./AgentTokenBalances";

export class AgentBotCollateralManagement {
    constructor(
        public agent: Agent,
        public agentBotSettings: AgentBotSettings,
        public notifier: AgentNotifier,
        public tokens: AgentTokenBalances,
    ) {}

    context = this.agent.context;

    /**
     * Checks both AgentBot's collateral ratios. In case of either being unhealthy, it tries to top up from owner's account in order to get out of Collateral Ratio Band or Liquidation due to price changes.
     * It sends notification about successful and unsuccessful top up.
     * At the end it also checks owner's balance and notifies when too low.
     */
    async checkAgentForCollateralRatiosAndTopUp(): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking collateral ratios.`);
        const agentInfo = await this.agent.getAgentInfoIfExists();
        if (agentInfo == null) return;
        await this.checkForVaultCollateralTopup(agentInfo);
        await this.checkForPoolCollateralTopup(agentInfo);
        logger.info(`Agent ${this.agent.vaultAddress} finished checking for collateral topups.`);
        await this.checkOwnerVaultCollateralBalance(agentInfo);
        await this.checkOwnerNativeBalance(agentInfo);
        await this.checkIfCanEndLiquidation(agentInfo);
    }

    async checkForVaultCollateralTopup(agentInfo: AgentInfo) {
        try {
            const vaultCollateralPrice = await this.agent.getVaultCollateralPrice();
            const requiredCrVaultCollateralBIPS = toBN(vaultCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(this.agentBotSettings.liquidationPreventionFactor);
            const requiredTopUpVaultCollateral = await this.requiredTopUp(requiredCrVaultCollateralBIPS, agentInfo, vaultCollateralPrice);
            if (requiredTopUpVaultCollateral.gt(BN_ZERO)) {
                const requiredTopUpF = await this.tokens.vaultCollateral.format(requiredTopUpVaultCollateral);
                try {
                    logger.info(`Agent ${this.agent.vaultAddress} is trying to top up vault collateral ${requiredTopUpF} from owner ${this.agent.owner}.`);
                    await this.agent.depositVaultCollateral(requiredTopUpVaultCollateral);
                    await this.notifier.sendVaultCollateralTopUpAlert(requiredTopUpF);
                    logger.info(`Agent ${this.agent.vaultAddress} topped up vault collateral ${requiredTopUpF} from owner ${this.agent.owner}.`);
                } catch (err) {
                    await this.notifier.sendVaultCollateralTopUpFailedAlert(requiredTopUpF);
                    logger.error(`Agent ${this.agent.vaultAddress} could not be topped up with vault collateral ${requiredTopUpF} from owner ${this.agent.owner}:`, err);
                }
            }
        } catch (error) {
            console.error(`Error while checking for vault collateral top up for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while checking for vault collateral top up:`, error);
        }
    }

    async checkForPoolCollateralTopup(agentInfo: AgentInfo) {
        try {
            const poolCollateralPrice = await this.agent.getPoolCollateralPrice();
            const requiredCrPoolBIPS = toBN(poolCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(this.agentBotSettings.liquidationPreventionFactor);
            const requiredTopUpPool = await this.requiredTopUp(requiredCrPoolBIPS, agentInfo, poolCollateralPrice);
            if (requiredTopUpPool.gt(BN_ZERO)) {
                const requiredTopUpF = await this.tokens.poolCollateral.format(requiredTopUpPool);
                try {
                    logger.info(`Agent ${this.agent.vaultAddress} is trying to buy collateral pool tokens ${requiredTopUpF} from owner ${this.agent.owner}.`);
                    await this.agent.buyCollateralPoolTokens(requiredTopUpPool);
                    await this.notifier.sendPoolCollateralTopUpAlert(requiredTopUpF);
                    logger.info(`Agent ${this.agent.vaultAddress} bought collateral pool tokens ${requiredTopUpF} from owner ${this.agent.owner}.`);
                } catch (err) {
                    await this.notifier.sendPoolCollateralTopUpFailedAlert(requiredTopUpF);
                    logger.error(`Agent ${this.agent.vaultAddress} could not buy collateral pool tokens ${requiredTopUpF} from owner ${this.agent.owner}:`, err);
                }
            }
        } catch (error) {
            console.error(`Error while checking for pool collateral top up for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while checking for pool collateral top up:`, error);
        }
    }

    async checkOwnerVaultCollateralBalance(agentInfo: AgentInfo) {
        try {
            const ownerBalanceVaultCollateral = await this.tokens.vaultCollateral.balance(this.agent.owner.workAddress);
            const vaultCollateralLowBalance = this.ownerVaultCollateralLowBalance(agentInfo);
            if (ownerBalanceVaultCollateral.lte(vaultCollateralLowBalance)) {
                const vaultBalanceF = await this.tokens.vaultCollateral.format(ownerBalanceVaultCollateral);
                await this.notifier.sendLowBalanceOnOwnersAddress(this.agent.owner.workAddress, vaultBalanceF);
                logger.info(`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner} has low vault collateral balance ${vaultBalanceF}.`);
            }
        } catch (error) {
            console.error(`Error while checking owner vault collateral balance for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while checking owner vault collateral balance:`, error);
        }
    }

    async checkOwnerNativeBalance(agentInfo: AgentInfo) {
        try {
            const ownerBalanceNative = await this.tokens.native.balance(this.agent.owner.workAddress);
            const nativeLowBalance = this.ownerNativeLowBalance(agentInfo);
            if (ownerBalanceNative.lte(nativeLowBalance)) {
                const nativeBalanceF = await this.tokens.native.format(ownerBalanceNative);
                await this.notifier.sendLowBalanceOnOwnersAddress(this.agent.owner.workAddress, nativeBalanceF);
                logger.info(`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner} has low native balance ${nativeBalanceF}.`);
            }
        } catch (error) {
            console.error(`Error while checking owner native balance for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while checking owner native balance:`, error);
        }
    }

    async checkIfCanEndLiquidation(agentInfo: AgentInfo): Promise<void> {
        try {
            const currentStatus = Number(agentInfo.status);
            if (currentStatus != AgentStatus.CCB && currentStatus != AgentStatus.LIQUIDATION) return;

            const vaultCollateral = await this.agent.getVaultCollateral();
            const poolCollateral = await this.agent.getPoolCollateral();
            const vaultCRBIPS = agentInfo.vaultCollateralRatioBIPS;
            const poolCRBIPS = agentInfo.poolCollateralRatioBIPS;

            let minVaultCollateralRatio;
            let minPoolCollateralRatio;

            if (currentStatus == AgentStatus.CCB) {
                minVaultCollateralRatio = toBN(vaultCollateral.minCollateralRatioBIPS);
                minPoolCollateralRatio = toBN(poolCollateral.minCollateralRatioBIPS);
            } else {
                minVaultCollateralRatio = toBN(vaultCollateral.safetyMinCollateralRatioBIPS);
                minPoolCollateralRatio = toBN(poolCollateral.safetyMinCollateralRatioBIPS);
            }

            if (vaultCRBIPS.gte(minVaultCollateralRatio) && poolCRBIPS.gte(minPoolCollateralRatio)) {
                await this.context.assetManager.endLiquidation(this.agent.vaultAddress, { from: this.agent.vaultAddress });
                logger.info(`Agent ${this.agent.vaultAddress} ended liquidation after price change.`);
            } else {
                logger.info(`Agent ${this.agent.vaultAddress} could not end liquidation after price change.`);
            }
        } catch (error) {
            console.error(`Error while checking if agent can end liquidation for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while checking if agent can end liquidation:`, error);
        }
    }

    /**
     * Returns the value that is required to be topped up in order to reach healthy collateral ratio.
     * If value is less than zero, top up is not needed.
     * @param requiredCrBIPS required collateral ratio for healthy state (in BIPS)
     * @param agentInfo AgentInfo object
     * @param cp CollateralPrice object
     * @return required amount for top up to reach healthy collateral ratio
     */
    private async requiredTopUp(requiredCrBIPS: BN, agentInfo: AgentInfo, cp: CollateralPrice): Promise<BN> {
        const redeemingUBA = Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.redeemingUBA : agentInfo.poolRedeemingUBA;
        const balance = toBN(Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.totalVaultCollateralWei : agentInfo.totalPoolCollateralNATWei);
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(redeemingUBA));
        const backingCollateralWei = cp.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingCollateralWei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(balance);
    }

    private ownerNativeLowBalance(agentInfo: AgentInfo): BN {
        const lockedPoolCollateral = toBN(agentInfo.totalPoolCollateralNATWei).sub(toBN(agentInfo.freePoolCollateralNATWei));
        return lockedPoolCollateral.muln(this.agentBotSettings.poolCollateralReserveFactor);
    }

    private ownerVaultCollateralLowBalance(agentInfo: AgentInfo): BN {
        const lockedVaultCollateral = toBN(agentInfo.totalVaultCollateralWei).sub(toBN(agentInfo.freeVaultCollateralWei));
        return lockedVaultCollateral.muln(this.agentBotSettings.vaultCollateralReserveFactor);
    }
}
