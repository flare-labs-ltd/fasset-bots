import BN from "bn.js";
import { TrackedAgentState } from "../../state/TrackedAgentState";
import { TrackedState } from "../../state/TrackedState";
import { BalanceDecreasingTransaction } from "@flarenetwork/state-connector-protocol";
import { EventScope } from "../../utils/events/ScopedEvents";
import { artifacts } from "../../utils/web3";
import { ActorBaseKind } from "../../fasset-bots/ActorBase";
import type { ChallengerInstance } from "../../../typechain-truffle";
import { ZERO_ADDRESS } from "../../utils";

const Challenger = artifacts.require("Challenger");

export abstract class ChallengeStrategy {
    constructor(
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
        await this.state.context.assetManager.illegalPaymentChallenge(proof, agent.vaultAddress, { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e,
                ["chlg: already liquidating", "chlg: transaction confirmed", "matching redemption active", "matching ongoing announced pmt"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        await this.state.context.assetManager.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e, ["chlg dbl: already liquidating"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, proofs: BalanceDecreasingTransaction.Proof[]) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        await this.state.context.assetManager.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e, ["mult chlg: already liquidating", "mult chlg: enough balance"],
                ActorBaseKind.CHALLENGER, this.address));
    }
}

export class DexChallengeStrategy extends ChallengeStrategy {
    protected async dexMinPriceOracle(challenger: ChallengerInstance, agent: TrackedAgentState): Promise<[BN, BN, BN, BN]> {
        const { 0: minPriceMulDex1, 1: minPriceDivDex1, 2: minPriceMulDex2, 3: minPriceDivDex2 } =
            await challenger.maxSlippageToMinPrices(1000, 2000, agent.vaultAddress, { from: this.address });
        return [minPriceMulDex1, minPriceDivDex1, minPriceMulDex2, minPriceDivDex2];
    }

    public async illegalTransactionChallenge(scope: EventScope, agent: TrackedAgentState, proof: BalanceDecreasingTransaction.Proof) {
        const challenger = await Challenger.at(this.state.context.challengeStrategy!.config.address);
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        await challenger.illegalPaymentChallenge(proof, agent.vaultAddress, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e,
                ["chlg: already liquidating", "chlg: transaction confirmed", "matching redemption active", "matching ongoing announced pmt"],
                ActorBaseKind.CHALLENGER, this.address));
    }

    public async doublePaymentChallenge(scope: EventScope, agent: TrackedAgentState, proof1: BalanceDecreasingTransaction.Proof, proof2: BalanceDecreasingTransaction.Proof) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const challenger = await Challenger.at(this.state.context.challengeStrategy!.config.address);
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        await challenger.doublePaymentChallenge(proof1, proof2, agent.vaultAddress, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e, ["chlg dbl: already liquidating"], ActorBaseKind.CHALLENGER, this.address));
    }

    public async freeBalanceNegativeChallenge(scope: EventScope, agent: TrackedAgentState, proofs: BalanceDecreasingTransaction.Proof[]) {
        // due to async nature of challenging there may be some false challenges which will be rejected
        const challenger = await Challenger.at(this.state.context.challengeStrategy!.config.address);
        const oraclePrices = await this.dexMinPriceOracle(challenger, agent);
        await challenger.freeBalanceNegativeChallenge(proofs, agent.vaultAddress, ...oraclePrices, ZERO_ADDRESS, ZERO_ADDRESS, [], [], { from: this.address })
            .catch((e) => scope.exitOnExpectedError(e, ["mult chlg: already liquidating", "mult chlg: enough balance"],
                ActorBaseKind.CHALLENGER, this.address));
    }
}
