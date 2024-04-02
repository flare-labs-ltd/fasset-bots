import BN from "bn.js";
import { LiquidatorInstance } from "../../../typechain-truffle";
import { ILiquidatorContext } from "../../fasset-bots/IAssetBotContext";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { ZERO_ADDRESS } from "../../utils";
import { artifacts } from "../../utils/web3";
import { TrackedState } from "../../state/TrackedState";

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
        await this.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address });
    }
}

export class DexLiquidationStrategy extends LiquidationStrategy {
    protected async dexMinPriceOracle(challenger: LiquidatorInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(1000, 2000, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    public async liquidate(agent: TrackedAgentState): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const liquidator = await Liquidator.at(this.context.liquidationStrategy!.config.address);
        const oraclePrices = await this.dexMinPriceOracle(liquidator, agent);
        await liquidator.runArbitrage(agent.vaultAddress, this.address, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address });
    }
}
