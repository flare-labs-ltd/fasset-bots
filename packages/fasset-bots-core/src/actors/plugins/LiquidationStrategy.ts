import BN from "bn.js";
import { LiquidatorInstance } from "../../../typechain-truffle";
import { ILiquidatorContext } from "../../fasset-bots/IAssetBotContext";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { TrackedState } from "../../state/TrackedState";
import { Currencies, ZERO_ADDRESS, formatFixed, logger, squashSpace, toBN } from "../../utils";
import { artifacts } from "../../utils/web3";

const Liquidator = artifacts.require("Liquidator");

export abstract class LiquidationStrategy {
    constructor(
        public context: ILiquidatorContext,
        public state: TrackedState,
        public address: string
    ) {}
    abstract performLiquidations(agent: TrackedAgentState[]): Promise<any>;
}

export class DefaultLiquidationStrategy extends LiquidationStrategy {

    public async performLiquidations(agents: TrackedAgentState[]): Promise<void> {
        if (agents.length === 0) return;
        logger.info(`Liquidator ${this.address} performing ${this.context.fAssetSymbol} liquidation on ${agents.length} agents.`);
        console.log(`Liquidator ${this.address} performing ${this.context.fAssetSymbol} liquidation on ${agents.length} agents.`);
        // sort by decreasing minted amount then descending by status (higher the status, the more rewards from liquidating)
        agents.sort((a, b) => -a.mintedUBA.cmp(b.mintedUBA));
        agents.sort((a, b) => a.status - b.status);
        for (const agent of agents) {
            try {
                await this.performLiquidation(agent);
            } catch (e) {
                logger.error(`Liquidator ${this.address} failed to liquidate agent ${agent.vaultAddress}: ${e}`);
                console.error(`Liquidator ${this.address} failed to liquidate agent ${agent.vaultAddress}`);
            }
        }
    }

    async performLiquidation(agent: TrackedAgentState) {
        const before = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        await this.liquidate(agent);
        const after = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        const diff = toBN(before.mintedUBA).sub(toBN(after.mintedUBA));
        const cur = await Currencies.fasset(this.context);
        const message = squashSpace`Liquidator ${this.address} liquidated agent ${agent.vaultAddress} for ${cur.format(diff)}.
            Minted before: ${cur.format(before.mintedUBA)}, after: ${cur.format(after.mintedUBA)}.
            Vault CR before: ${formatFixed(toBN(before.vaultCollateralRatioBIPS), 4)}, after: ${formatFixed(toBN(after.vaultCollateralRatioBIPS), 4)}.
            Pool CR before: ${formatFixed(toBN(before.poolCollateralRatioBIPS), 4)}, after: ${formatFixed(toBN(after.poolCollateralRatioBIPS), 4)}.`;
        logger.info(message);
        console.log(message);
    }

    protected async liquidate(agent: TrackedAgentState): Promise<void> {
        const fBalance = await this.context.fAsset.balanceOf(this.address);
        if (fBalance.gte(toBN(this.state.settings.assetMintingGranularityUBA))) {
            await this.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address, gasPrice: this.getGasPrice() });
        } else {
            const fassetSymbol = this.context.fAssetSymbol;
            logger.info(`Liquidator ${this.address} has no ${fassetSymbol} available for liqudating agent ${agent.vaultAddress}`);
            console.log(`Liquidator ${this.address} has zero ${fassetSymbol} balance, cannot liquidate ${agent.vaultAddress}.`);
        }
    }

    protected getGasPrice(): BN | undefined {
        if (this.context.liquidationStrategy?.config?.gasPrice === undefined) return undefined;
        return toBN(this.context.liquidationStrategy?.config?.gasPrice);
    }
}

export class DexLiquidationStrategy extends LiquidationStrategy {
    protected async dexMinPriceOracle(challenger: LiquidatorInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(1000, 2000, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    async performLiquidations(agents: TrackedAgentState[]): Promise<void> {
        for (const agent of agents) {
            await this.performLiquidation(agent);
        }
    }

    async performLiquidation(agent: TrackedAgentState): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const liquidator = await Liquidator.at(this.context.liquidationStrategy!.config.address);
        const oraclePrices = await this.dexMinPriceOracle(liquidator, agent);
        await liquidator.runArbitrage(agent.vaultAddress, this.address, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address });
    }
}
