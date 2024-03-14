import BN from "bn.js";
import { LiquidatorInstance } from "../../../typechain-truffle";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { TrackedState } from "../../state/TrackedState";
import { artifacts } from "../../utils/web3";
import { ZERO_ADDRESS } from "../../utils";

const Liquidator = artifacts.require("Liquidator");

export abstract class LiquidationStrategy {
    constructor(
        public state: TrackedState,
        public address: string
    ) {}
    abstract liquidate(agent: TrackedAgentState): Promise<any>;
}

export class DefaultLiquidationStrategy extends LiquidationStrategy {
    public async liquidate(agent: TrackedAgentState): Promise<void> {
        const fBalance = await this.state.context.fAsset.balanceOf(this.address);
        await this.state.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address });
    }
}

export class DexLiquidationStrategy extends LiquidationStrategy {
    protected async dexMinPriceOracle(challenger: LiquidatorInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(1000, 2000, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    public async liquidate(agent: TrackedAgentState): Promise<void> {
        const liquidator = await Liquidator.at(this.state.context.liquidationStrategy!.config.address);
        const oraclePrices = await this.dexMinPriceOracle(liquidator, agent);
        await liquidator.runArbitrage(agent.vaultAddress, this.address, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address });
    }
}
