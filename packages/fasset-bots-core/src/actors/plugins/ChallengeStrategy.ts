import { BalanceDecreasingTransaction } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import type { ChallengerInstance } from "../../../typechain-truffle";
import { ActorBaseKind } from "../../fasset-bots/ActorBase";
import { IChallengerContext } from "../../fasset-bots/IAssetBotContext";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { RequireFields, ZERO_ADDRESS } from "../../utils";
import { EventScope } from "../../utils/events/ScopedEvents";
import { artifacts } from "../../utils/web3";
import { TrackedState } from "../../state/TrackedState";
import { toBN } from "web3-utils";

const Challenger = artifacts.require("Challenger");

export abstract class ChallengeStrategy<C extends IChallengerContext = IChallengerContext> {
    constructor(
        public context: C,
        public state: TrackedState,
        public address: string
    ) {}

    abstract illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof): Promise<any>;

    abstract doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof): Promise<any>;

    abstract freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, transactionHashes: BalanceDecreasingTransaction.Proof[]): Promise<any>;
}

export class DefaultChallengeStrategy extends ChallengeStrategy {
    public async illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging (and the fact that challenger might start tracking agent later),
        // there may be some false challenges which will be rejected
        // this is perfectly safe for the system, but the errors must be caught
        const gasPrice = this.context.challengeStrategy?.config?.gasPrice;
        await this.context.assetManager.illegalPaymentChallenge(proof, agent.vaultAddress, { from: this.address, gasPrice: this.getGasPrice() })
            .catch((e) => scope.exitOnExpectedError(e,
                ["chlg: already liquidating", "chlg: transaction confirmed", "matching redemption active", "matching ongoing announced pmt"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const gasPrice = this.context.challengeStrategy?.config?.gasPrice;
        await this.context.assetManager.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, { from: this.address, gasPrice: this.getGasPrice() })
            .catch((e) => scope.exitOnExpectedError(e, ["chlg dbl: already liquidating"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, proofs: BalanceDecreasingTransaction.Proof[]) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        await this.context.assetManager.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, { from: this.address, gasPrice: this.getGasPrice() })
            .catch((e) => scope.exitOnExpectedError(e, ["mult chlg: already liquidating", "mult chlg: enough balance"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    protected getGasPrice(): BN | undefined {
        if (this.context.challengeStrategy?.config?.gasPrice === undefined) return undefined;
        return toBN(this.context.challengeStrategy?.config?.gasPrice);
    }
}

type IDEXChallengerContext = RequireFields<IChallengerContext, "challengeStrategy">;

export class DexChallengeStrategy extends ChallengeStrategy<IDEXChallengerContext> {
    protected async dexMinPriceOracle(challenger: ChallengerInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(1000, 2000, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    public async illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof) {
        const challenger = await Challenger.at(this.context.challengeStrategy.config.address);
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        await challenger.illegalPaymentChallenge(proof, agent.vaultAddress, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e,
                ["chlg: already liquidating", "chlg: transaction confirmed", "matching redemption active", "matching ongoing announced pmt"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const challenger = await Challenger.at(this.context.challengeStrategy.config.address);
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        await challenger.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e, ["chlg dbl: already liquidating"], ActorBaseKind.CHALLENGER, this.address));
    }

    public async freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, proofs: BalanceDecreasingTransaction.Proof[]) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const challenger = await Challenger.at(this.context.challengeStrategy.config.address);
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        await challenger.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e, ["mult chlg: already liquidating", "mult chlg: enough balance"],
                ActorBaseKind.CHALLENGER, this.address));
    }
}
