import BN from "bn.js";
import { Agent } from "../fasset/Agent";
import { AgentInfo, CollateralClass } from "../fasset/AssetManagerTypes";
import { CollateralPrice } from "../state/CollateralPrice";
import { BN_ZERO, CCB_LIQUIDATION_PREVENTION_FACTOR, MAX_BIPS, POOL_COLLATERAL_RESERVE_FACTOR, VAULT_COLLATERAL_RESERVE_FACTOR, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentTokenBalances } from "./AgentTokenBalances";

export class AgentBotCollateralManagement {
    constructor(
        public agent: Agent,
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
    }

    async checkForVaultCollateralTopup(agentInfo: AgentInfo) {
        const vaultCollateralPrice = await this.agent.getVaultCollateralPrice();
        const requiredCrVaultCollateralBIPS = toBN(vaultCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
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
    }

    async checkForPoolCollateralTopup(agentInfo: AgentInfo) {
        const poolCollateralPrice = await this.agent.getPoolCollateralPrice();
        const requiredCrPoolBIPS = toBN(poolCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
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
    }

    async checkOwnerVaultCollateralBalance(agentInfo: AgentInfo) {
        const ownerBalanceVaultCollateral = await this.tokens.vaultCollateral.balance(this.agent.owner.workAddress);
        const vaultCollateralLowBalance = this.ownerVaultCollateralLowBalance(agentInfo);
        if (ownerBalanceVaultCollateral.lte(vaultCollateralLowBalance)) {
            const vaultBalanceF = await this.tokens.vaultCollateral.format(ownerBalanceVaultCollateral);
            await this.notifier.sendLowBalanceOnOwnersAddress(this.agent.owner.workAddress, vaultBalanceF);
            logger.info(`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner} has low vault collateral balance ${vaultBalanceF}.`);
        }
    }

    async checkOwnerNativeBalance(agentInfo: AgentInfo) {
        const ownerBalanceNative = await this.tokens.native.balance(this.agent.owner.workAddress);
        const nativeLowBalance = this.ownerNativeLowBalance(agentInfo);
        if (ownerBalanceNative.lte(nativeLowBalance)) {
            const nativeBalanceF = await this.tokens.native.format(ownerBalanceNative);
            await this.notifier.sendLowBalanceOnOwnersAddress(this.agent.owner.workAddress, nativeBalanceF);
            logger.info(`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner} has low native balance ${nativeBalanceF}.`);
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
        const backingVaultCollateralWei = cp.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingVaultCollateralWei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(balance);
    }

    private ownerNativeLowBalance(agentInfo: AgentInfo): BN {
        const lockedPoolCollateral = toBN(agentInfo.totalPoolCollateralNATWei).sub(toBN(agentInfo.freePoolCollateralNATWei));
        return lockedPoolCollateral.muln(POOL_COLLATERAL_RESERVE_FACTOR);
    }

    private ownerVaultCollateralLowBalance(agentInfo: AgentInfo): BN {
        const lockedVaultCollateral = toBN(agentInfo.totalVaultCollateralWei).sub(toBN(agentInfo.freeVaultCollateralWei));
        return lockedVaultCollateral.muln(VAULT_COLLATERAL_RESERVE_FACTOR);
    }
}