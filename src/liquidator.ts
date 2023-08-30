import { IAgentVault, IBlazeSwapRouter } from '../typechain';
import { IAgentArbitrageData, IContext } from './interface'
import { getContract, getAssetPriceInVaultCollateral, divBips, min, mulBips } from './util'
import { AgentVault, BlazeSwap } from './actors'

// assummes that pool collateral is always wrapped native

// one liquidator instance for each f-asset
export class Liquidator {
  public agents: AgentVault[] = []
  public blazeSwaps: BlazeSwap[] = []

  constructor(public context: IContext) {
    // save agent vaults
    context.addresses.agentVault.map(async (agent) => this.agents.push(
      new AgentVault(getContract<IAgentVault>(context.provider, agent.address, "IAgentVault"))  
    ))
    // save dexs
    context.addresses.dex.map((dex) => this.blazeSwaps.push(
      new BlazeSwap(getContract<IBlazeSwapRouter>(context.provider, dex.address, "IBlazeSwap"))
    ))
  }

  public async init() {
    await Promise.all(this.agents.map(async (agent) => {
      await agent.setConstantData(this.context)
      await agent.setPseudoConstantData(this.context)
    }))
  }

  public async runArbitrage(): Promise<void> {
    // find the best agent from which to liquidate 
    // (by max liquidation and liquidation factor, ignore pool collateral)
    let selectedAgent: {
      object: AgentVault
      data: IAgentArbitrageData
      quality: bigint
    } | undefined
    for (const agent of this.agents) {
      const data = await agent.checkForAgentArbitrageAndGetData(this.context)
      if (data !== null) {
        const quality = data.maxLiquidation * data.vaultCR.factor
        if (selectedAgent === undefined || quality > selectedAgent.quality) {
          selectedAgent = { object: agent, data: data, quality: quality }
        }
      }
    }
    if (selectedAgent === undefined) return
    // find the best-suitable liquidity pool (by the max profit)
    let selectedDex: {
      object: BlazeSwap
      optimalVaultCollateral: bigint
      liquidatorProfit: bigint
    } | undefined
    for (const blazeSwap of this.blazeSwaps) {
      const [reserveVaultCollateral, reserveFAsset] = 
        await blazeSwap.getPoolReserves(
          selectedAgent.data.poolCollateralToken, 
          selectedAgent.data.vaultCollateralToken
        )
      const fee = await blazeSwap.getPoolFee(
        selectedAgent.data.poolCollateralToken, 
        selectedAgent.data.vaultCollateralToken
      )
      const assetPriceUSDT = await getAssetPriceInVaultCollateral(
        this.context, 
        selectedAgent.object.vaultCollateralSymbol, 
        selectedAgent.object.fAssetSymbol, 
        selectedAgent.object.fAssetDecimals
      )
      const optimalVaultCollateral = this.getOptimalVaultCollateral(
        selectedAgent.data,
        assetPriceUSDT,
        reserveVaultCollateral,
        reserveFAsset,
        fee
      )
      const liquidatedFAssets = this.getFAssetSwappedFromVaultCollateral(
        optimalVaultCollateral, reserveVaultCollateral, reserveFAsset, fee
      )
      const liquidatorProfit = this.getLiquidatorProfit(
        optimalVaultCollateral, 
        liquidatedFAssets, 
        selectedAgent.data.vaultCR.factor, 
        assetPriceUSDT
      )
      if (selectedDex === undefined || liquidatorProfit > selectedDex.liquidatorProfit) {
        selectedDex = { object: blazeSwap, optimalVaultCollateral, liquidatorProfit }
      }
    }
    if (selectedDex === undefined) return
    // execute arbitrage
    await this.context.liquidator.executeArbitrage(
      selectedDex.optimalVaultCollateral,
      this.context.wNat,
      selectedAgent.object.fAsset,
      selectedAgent.object.vaultCollateral,
      selectedDex.object.contract,
      selectedAgent.object.assetManager,
      selectedAgent.object.contract
    )
  }

  // optimal value of the vault collateral to swap for fAsset and then liquidate
  // maximizing M(v) = min(Fd v (1 - δ) / (v (1 - δ) + Vd), fm) Ra P - v
  // gets vo = min(Vd Fd Ra P - 1 / (1 - δ), fm Vd / ((1 - δ) (Fd - fm))
  protected getOptimalVaultCollateral(
    agentArbitrageData: IAgentArbitrageData,
    fAssetInVaulCollateralPrice: bigint,
    lpReserveVaultCollateral: bigint,
    lpReserveFAsset: bigint,
    poolFee: bigint
  ): bigint {
    const poolFactor = BigInt(10_000) - poolFee
    const maxLiquidatonFAssetCap = agentArbitrageData.minted * agentArbitrageData.vaultCR.target
      * (fAssetInVaulCollateralPrice - agentArbitrageData.vaultCR.current)
      / (agentArbitrageData.vaultCR.target - agentArbitrageData.vaultCR.current)
    const maxLiquidationVaultCollateralCap = divBips(
      maxLiquidatonFAssetCap * lpReserveVaultCollateral, poolFactor
    ) / (lpReserveFAsset - maxLiquidatonFAssetCap)
    const optimalLiquidationVaultCollateral = 
      (lpReserveVaultCollateral * lpReserveFAsset * agentArbitrageData.vaultCR.factor 
        * fAssetInVaulCollateralPrice * poolFactor - BigInt(10_000)
      ) / poolFactor
    return min(optimalLiquidationVaultCollateral, maxLiquidationVaultCollateralCap)
  }

  // calculates the obtained f-assets when swapping from vault collateral on dex
  // f(v) = Fd v (1 - δ) / (v (1 - δ) + Vd)
  protected getFAssetSwappedFromVaultCollateral(
    vaultCollateral: bigint,
    lpReserveVaultCollateral: bigint,
    lpReserveFAsset: bigint,
    poolFee: bigint
  ): bigint {
    const vaultCollateralWithFee = mulBips(vaultCollateral, BigInt(10_000) - poolFee)
    return vaultCollateralWithFee * lpReserveFAsset / (vaultCollateralWithFee + lpReserveVaultCollateral)
  }

  // calculates f-asset liquidation profit
  // f(v) * P * Ra - v
  protected getLiquidatorProfit(
    usedVaultCollateral: bigint,
    liquidatedFAssets: bigint,
    liquidationFactor: bigint,
    fAssetToVaultCollateralPrice: bigint
  ): bigint {
    return liquidatedFAssets * fAssetToVaultCollateralPrice * liquidationFactor - usedVaultCollateral
  }
  
} 