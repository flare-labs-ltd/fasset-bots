import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { InitialAgentData, TrackedAgentState } from "../../src/state/TrackedAgentState";
import { TrackedState } from "../../src/state/TrackedState";
import { latestBlockTimestamp } from "../../src/utils/web3helpers";
import { FuzzingStateComparator } from "./FuzzingStateComparator";

export class FuzzingStateAgent extends TrackedAgentState {
    constructor(
        parent: TrackedState,
        data: InitialAgentData,
    ) {
        super(parent, data);
    }


    async checkInvariants(checker: FuzzingStateComparator, agentName: string) {
        // get actual agent state
        const agentInfo = await this.parent.context.assetManager.getAgentInfo(this.vaultAddress);
        let problems = 0;
        // reserved
        problems += checker.checkEquality(`${agentName}.reservedUBA`, agentInfo.reservedUBA, this.reservedUBA);
        // problems += checker.checkEquality(`${agentName}.reservedUBA.cumulative`, this.reservedUBA, reservedUBA);
        // minted
        // const mintedUBA = this.calculateMintedUBA();
        problems += checker.checkEquality(`${agentName}.mintedUBA`, agentInfo.mintedUBA, this.mintedUBA);
        // problems += checker.checkEquality(`${agentName}.mintedUBA.cumulative`, this.mintedUBA, mintedUBA);
        // redeeming
        // const redeemingUBA = this.calculateRedeemingUBA();
        problems += checker.checkEquality(`${agentName}.redeemingUBA`, agentInfo.redeemingUBA, this.redeemingUBA);
        // problems += checker.checkEquality(`${agentName}.redeemingUBA.cumulative`, this.redeemingUBA, redeemingUBA);
        // poolRedeeming
        // const poolRedeemingUBA = this.calculatePoolRedeemingUBA();
        problems += checker.checkEquality(`${agentName}.poolRedeemingUBA`, agentInfo.poolRedeemingUBA, this.poolRedeemingUBA);
        // problems += checker.checkEquality(`${agentName}.poolRedeemingUBA.cumulative`, this.poolRedeemingUBA, poolRedeemingUBA);
        // free balance
        // const freeUnderlyingBalanceUBA = this.calculateFreeUnderlyingBalanceUBA();
        problems += checker.checkEquality(`${agentName}.underlyingFreeBalanceUBA`, agentInfo.freeUnderlyingBalanceUBA, this.freeUnderlyingBalanceUBA);
        // problems += checker.checkEquality(`${agentName}.underlyingFreeBalanceUBA.cumulative`, this.freeUnderlyingBalanceUBA, freeUnderlyingBalanceUBA);
        // pool fees
        /*
        const collateralPool = await CollateralPool.at(this.collateralPoolAddress);
        const collateralPoolToken = await CollateralPoolToken.at(requireNotNull(this.poolTokenAddress));
        const collateralPoolName = this.poolName();
        problems += checker.checkEquality(`${collateralPoolName}.totalPoolFees`, await this.parent.context.fAsset.balanceOf(this.collateralPoolAddress), this.totalPoolFee);
        problems += checker.checkEquality(`${collateralPoolName}.totalPoolTokens`, await collateralPoolToken.totalSupply(), this.poolTokenBalances.total());
        problems += checker.checkEquality(`${collateralPoolName}.totalPoolFeeDebt`, await collateralPool.totalFAssetFeeDebt(), this.poolFeeDebt.total());
        for (const tokenHolder of this.poolTokenBalances.keys()) {
            const tokenHolderName = this.parent.eventFormatter.formatAddress(tokenHolder);
            problems += checker.checkEquality(`${collateralPoolName}.poolTokensOf(${tokenHolderName})`, await collateralPoolToken.balanceOf(tokenHolder), this.poolTokenBalances.get(tokenHolder));
            const poolFeeDebt = await collateralPool.fAssetFeeDebtOf(tokenHolder);
            problems += checker.checkEquality(`${collateralPoolName}.poolFeeDebtOf(${tokenHolderName})`, poolFeeDebt, this.poolFeeDebt.get(tokenHolder));
            const virtualFees = await collateralPool.virtualFAssetOf(tokenHolder);
            problems += checker.checkEquality(`${collateralPoolName}.virtualPoolFeesOf(${tokenHolderName})`, virtualFees, this.calculateVirtualFeesOf(tokenHolder));
            problems += checker.checkNumericDifference(`${collateralPoolName}.virtualPoolFeesOf(${tokenHolderName}) >= debt`, virtualFees, 'gte', poolFeeDebt);
        }*/
        // minimum underlying backing (unless in full liquidation)
        if (this.status !== AgentStatus.FULL_LIQUIDATION) {
            const underlyingBalanceUBA = await this.parent.context.chain.getBalance(this.underlyingAddress);
            problems += checker.checkNumericDifference(`${agentName}.underlyingBalanceUBA`, underlyingBalanceUBA, 'gte', this.mintedUBA.add(this.freeUnderlyingBalanceUBA));
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