import BN from "bn.js";
import { LiquidatorInstance } from "../../../typechain-truffle";
import { ILiquidatorContext } from "../../fasset-bots/IAssetBotContext";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { TrackedState } from "../../state/TrackedState";
import { BN_ZERO, ZERO_ADDRESS, logger } from "../../utils";
import { artifacts } from "../../utils/web3";
import type { DexLiquidationStrategyConfig } from "../../config";

const Liquidator = artifacts.require("Liquidator");

export abstract class LiquidationStrategy {
    constructor(
        public context: ILiquidatorContext,
        public state: TrackedState,
        public address: string
    ) {}
    abstract liquidate(agent: TrackedAgentState): Promise<any>;
}

export class DefaultLiquidationStrategy extends LiquidationStrategy {
    public async liquidate(agent: TrackedAgentState): Promise<void> {
        const fBalance = await this.context.fAsset.balanceOf(this.address);
        if (fBalance.gt(BN_ZERO)) {
            await this.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address });
        } else {
            logger.info(`Liquidator ${this.address} has no FAssets available for liqudating agent ${agent.vaultAddress}`);
        }
    }
}

export class DexLiquidationStrategy extends LiquidationStrategy {
    config: DexLiquidationStrategyConfig;

    constructor(
        public context: ILiquidatorContext,
        public state: TrackedState,
        public address: string
    ) {
        super(context, state, address);
        this.config = context.liquidationStrategy!.config as DexLiquidationStrategyConfig;
    }

    protected async dexMinPriceOracle(challenger: LiquidatorInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const maxSlippage = this.config.maxAllowedSlippage
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(maxSlippage, maxSlippage, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    public async liquidate(agent: TrackedAgentState): Promise<void> {
        const liquidator = await Liquidator.at(this.config.address);
        const oraclePrices = await this.dexMinPriceOracle(liquidator, agent);
        await liquidator.runArbitrage(agent.vaultAddress, this.address, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address });
    }
}
