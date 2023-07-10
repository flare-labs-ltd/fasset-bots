import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { MockChainWallet } from "../../src/mock/MockChain";
import { InitialAgentData, TrackedAgentState } from "../../src/state/TrackedAgentState";
import { TrackedState } from "../../src/state/TrackedState";
import { latestBlockTimestamp } from "../../src/utils/web3helpers";
import { FuzzingStateComparator } from "./FuzzingStateComparator";

export class FuzzingStateAgent extends TrackedAgentState {
    constructor(
        parent: TrackedState,
        data: InitialAgentData,
        public wallet: MockChainWallet
    ) {
        super(parent, data);
    }


    async checkInvariants(checker: FuzzingStateComparator, agentName: string) {
        // get actual agent state
        const agentInfo = await this.parent.context.assetManager.getAgentInfo(this.vaultAddress);
        let problems = 0;
        // reserved
        problems += checker.checkEquality(`${agentName}.reservedUBA`, agentInfo.reservedUBA, this.reservedUBA);
        // minted
        problems += checker.checkEquality(`${agentName}.mintedUBA`, agentInfo.mintedUBA, this.mintedUBA);
        // redeeming
        problems += checker.checkEquality(`${agentName}.redeemingUBA`, agentInfo.redeemingUBA, this.redeemingUBA);
        // poolRedeeming
        problems += checker.checkEquality(`${agentName}.poolRedeemingUBA`, agentInfo.poolRedeemingUBA, this.poolRedeemingUBA);
        // free balance
        problems += checker.checkEquality(`${agentName}.underlyingFreeBalanceUBA`, agentInfo.freeUnderlyingBalanceUBA, this.freeUnderlyingBalanceUBA);
        // minimum underlying backing (unless in full liquidation)
        if (this.status !== AgentStatus.FULL_LIQUIDATION) {
            problems += checker.checkNumericDifference(`${agentName}.underlyingBalanceUBA`, agentInfo.underlyingBalanceUBA, 'gte', this.mintedUBA.add(this.freeUnderlyingBalanceUBA));
        }
        // dust
        problems += checker.checkEquality(`${agentName}.dustUBA`, this.dustUBA, agentInfo.dustUBA);
        // status
        if (!(this.status === AgentStatus.CCB && Number(agentInfo.status) === Number(AgentStatus.LIQUIDATION))) {
            problems += checker.checkStringEquality(`${agentName}.status`, agentInfo.status, this.status);
        } else {
            console.log(`    ${agentName}.status: CCB -> LIQUIDATION issue, time=${await latestBlockTimestamp() - Number(this.ccbStartTimestamp)}`);
        }
        // log
        if (problems > 0) {
            console.log("PROBLEMS:", problems);
        }
    }
}