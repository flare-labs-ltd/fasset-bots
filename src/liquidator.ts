import { IIAgentVault, IBlazeSwapRouter } from '../typechain-ethers'
import { AgentArbitrageData, Context } from './interface'
import { getContract, divBips, min, mulBips } from './util'
import { AgentVault, BlazeSwap } from './actors'

// does not account for whhen vault collateral is non 18 decimals or non usd pegged
export async function getAssetPriceInVaultCollateral(
  context: Context, 
  vaultCollateralSymbol: string, 
  fAssetSymbol: string, 
  fAssetDecimals: bigint
): Promise<bigint> {
  const { _price, _assetPriceUsdDecimals } = await context.ftsoRegistry["getCurrentPriceWithDecimals(string)"](fAssetSymbol)
  const exp = fAssetDecimals + BigInt(18) - _assetPriceUsdDecimals
  return _price ** exp
}

// one liquidator instance for each f-asset
export class Liquidator {
  public agents: AgentVault[] = []
  public blazeSwaps: BlazeSwap[] = []

  constructor(public context: Context) {
    // save agent vaults
    context.addresses.agentVault.map(async (agent) => this.agents.push(
      new AgentVault(getContract<IIAgentVault>(context.provider, agent.address, "IIAgentVault"))  
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
      data: AgentArbitrageData
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
      const arbitrage = await this.getArbitrageProfit(
        selectedAgent.object, selectedAgent.data, blazeSwap
      )
      if (selectedDex === undefined || arbitrage.liquidatorProfit > selectedDex.liquidatorProfit) {
        selectedDex = { object: blazeSwap, ...arbitrage }
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

  public async getArbitrageProfit(
    agentVault: AgentVault, 
    agentArbitrageData: AgentArbitrageData,
    blazeSwap: BlazeSwap
  ): Promise<{
    optimalVaultCollateral: bigint,
    liquidatorProfit: bigint
  }> {
    const [reserveVaultCollateral, reserveFAsset] = 
      await blazeSwap.getPoolReserves(
        agentArbitrageData.poolCollateralToken, 
        agentArbitrageData.vaultCollateralToken
      )
    const fee = await blazeSwap.getPoolFee(
      agentArbitrageData.poolCollateralToken, 
      agentArbitrageData.vaultCollateralToken
    )
    const assetPriceUSDT = 
      await getAssetPriceInVaultCollateral(
        this.context, 
        agentVault.vaultCollateralSymbol, 
        agentVault.fAssetSymbol, 
        agentVault.fAssetDecimals
      )
    const optimalVaultCollateral = 
      this.getOptimalVaultCollateral(
        agentArbitrageData,
        assetPriceUSDT,
        reserveVaultCollateral,
        reserveFAsset,
        fee
      )
    const liquidatedFAssets = 
      this.getFAssetSwappedFromVaultCollateral(
        optimalVaultCollateral, 
        reserveVaultCollateral, 
        reserveFAsset, 
        fee
      )
    const liquidatorProfit = this.getLiquidationProfit(
      optimalVaultCollateral, 
      liquidatedFAssets, 
      agentArbitrageData.vaultCR.factor, 
      assetPriceUSDT
    )
    return { optimalVaultCollateral, liquidatorProfit }
  }

  // optimal value of the vault collateral to swap for fAsset and then liquidate
  // maximizing M(v) = min(Fd v (1 - δ) / (v (1 - δ) + Vd), fm) Ra P - v
  // gets vo = min(Vd Fd Ra P - 1 / (1 - δ), fm Vd / ((1 - δ) (Fd - fm))
  protected getOptimalVaultCollateral(
    agentArbitrageData: AgentArbitrageData,
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
  protected getLiquidationProfit(
    usedVaultCollateral: bigint,
    liquidatedFAssets: bigint,
    liquidationFactor: bigint,
    fAssetToVaultCollateralPrice: bigint
  ): bigint {
    return liquidatedFAssets * fAssetToVaultCollateralPrice * liquidationFactor - usedVaultCollateral
  }
  
} 