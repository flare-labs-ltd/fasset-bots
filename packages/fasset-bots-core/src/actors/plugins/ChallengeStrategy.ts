import { BalanceDecreasingTransaction } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import type { ChallengerInstance } from "../../../typechain-truffle";
import { ActorBaseKind } from "../../fasset-bots/ActorBase";
import { IChallengerContext } from "../../fasset-bots/IAssetBotContext";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { MAX_BIPS, ZERO_ADDRESS } from "../../utils";
import { EventScope } from "../../utils/events/ScopedEvents";
import { artifacts } from "../../utils/web3";
import { TrackedState } from "../../state/TrackedState";
import { DexChallengeStrategyConfig, DefaultLiquidationStrategyConfig } from "../../config";

const Challenger = artifacts.require("Challenger");

export abstract class ChallengeStrategy<T> {
    config: T

    constructor(
        public context: IChallengerContext,
        public state: TrackedState,
        public address: string
    ) {
        this.config = context.challengeStrategy?.config as T;
    }

    abstract illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof): Promise<any>;

    abstract doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof): Promise<any>;

    abstract freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, transactionHashes: BalanceDecreasingTransaction.Proof[]): Promise<any>;
}

export class DefaultChallengeStrategy extends ChallengeStrategy<DefaultLiquidationStrategyConfig | undefined> {

    public async illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging (and the fact that challenger might start tracking agent later),
        // there may be some false challenges which will be rejected
        // this is perfectly safe for the system, but the errors must be caught
        await this.context.assetManager.illegalPaymentChallenge(proof, agent.vaultAddress, {
            from: this.address, maxPriorityFeePerGas: this.config?.maxPriorityFeePerGas })
            .catch((e) => scope.exitOnExpectedError(e,
                ["chlg: already liquidating", "chlg: transaction confirmed", "matching redemption active", "matching ongoing announced pmt"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        await this.context.assetManager.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, {
            from: this.address, maxPriorityFeePerGas: this.config?.maxPriorityFeePerGas })
            .catch((e) => scope.exitOnExpectedError(e, ["chlg dbl: already liquidating"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, proofs: BalanceDecreasingTransaction.Proof[]) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        await this.context.assetManager.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, {
            from: this.address, maxPriorityFeePerGas: this.config?.maxPriorityFeePerGas })
            .catch((e) => scope.exitOnExpectedError(e, ["mult chlg: already liquidating", "mult chlg: enough balance"],
                ActorBaseKind.CHALLENGER, this.address));
    }
}

export class DexChallengeStrategy extends ChallengeStrategy<DexChallengeStrategyConfig> {

    protected async dexMinPriceOracle(challenger: ChallengerInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const maxSlippage = this.config.maxAllowedSlippage ?? 0.02;
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(maxSlippage, maxSlippage, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    public async illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof) {
        const challenger = await Challenger.at(this.config.address);
        const arbitrageConfig = await this.arbitrageConfig(challenger, agent);
        await challenger.illegalPaymentChallenge(proof, agent.vaultAddress, this.address, arbitrageConfig, {
            from: this.address, maxPriorityFeePerGas: this.config.maxPriorityFeePerGas })
            .catch((e) => scope.exitOnExpectedError(e,
                ["chlg: already liquidating", "chlg: transaction confirmed", "matching redemption active", "matching ongoing announced pmt"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const challenger = await Challenger.at(this.config.address);
        const arbitrageConfig = await this.arbitrageConfig(challenger, agent);
        await challenger.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, this.address, arbitrageConfig, {
            from: this.address, maxPriorityFeePerGas: this.config.maxPriorityFeePerGas })
            .catch((e) => scope.exitOnExpectedError(e, ["chlg dbl: already liquidating"], ActorBaseKind.CHALLENGER, this.address));
    }

    public async freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, proofs: BalanceDecreasingTransaction.Proof[]) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const challenger = await Challenger.at(this.config.address);
        const arbitrageConfig = await this.arbitrageConfig(challenger, agent);
        await challenger.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, this.address, arbitrageConfig, {
            from: this.address, maxPriorityFeePerGas: this.config.maxPriorityFeePerGas })
            .catch((e) => scope.exitOnExpectedError(e, ["mult chlg: already liquidating", "mult chlg: enough balance"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    private async arbitrageConfig(challenger: ChallengerInstance, agent: TrackedAgentState) {
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        const maxFlashFee = this.config.maxFlashFee ?? 0.1;
        return {
            flashLender: this.config.flashLender ?? ZERO_ADDRESS,
            maxFlashFeeBips: MAX_BIPS * maxFlashFee,
            dex: this.config.dexRouter ?? ZERO_ADDRESS,
            dexPair1: {
                path: [],
                minPriceMul: oraclePrices[0],
                minPriceDiv: oraclePrices[1]
            },
            dexPair2: {
                path: [],
                minPriceMul: oraclePrices[2],
                minPriceDiv: oraclePrices[3]
            }
         }
    }
}
