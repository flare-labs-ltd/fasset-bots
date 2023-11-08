import { TrackedAgentState } from "../../state/TrackedAgentState";
import { TrackedState } from "../../state/TrackedState";
import { artifacts } from "../../utils/web3";

const Liquidator = artifacts.require("Liquidator");

export abstract class LiquidationStrategy {
    constructor(public state: TrackedState, public address: string) { }
    abstract liquidate(agent: TrackedAgentState): Promise<any>;
}

export class DefaultLiquidationStrategy extends LiquidationStrategy {
    public async liquidate(agent: TrackedAgentState): Promise<void> {
        const fBalance = await this.state.context.fAsset.balanceOf(this.address);
        await this.state.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address });
    }
}

export class LiveLiquidationStrategy extends LiquidationStrategy {
    public async liquidate(agent: TrackedAgentState): Promise<void> {
        const liquidator = await Liquidator.at(this.state.context.liquidationStrategy!.config.address);
        await liquidator.runArbitrage(agent.vaultAddress, { from: this.address });
    }
}