import { IAgentVault, IBlazeSwapRouter } from '../typechain';
import { IAgentArbitrageData, IContext } from './interface'
import { getContract, getAssetPriceInVaultCollateral, divBips, min, mulBips } from './util'
import { AgentVault, BlazeSwap } from './actors'

// assummes that pool collateral is always wrapped native

// one liquidator instance for each f-asset
export class Liquidator {
  public agentVaults: AgentVault[] = []
  public blazeSwaps: BlazeSwap[] = []

  constructor(public context: IContext) {
    // save agent vaults
    context.addresses.agentVault.map(async (agent) => this.agentVaults.push(
      new AgentVault(getContract<IAgentVault>(context.provider, agent.address, "IAgentVault"))  
    ))
    // save dexs
    context.addresses.dex.map((dex) => this.blazeSwaps.push(
      new BlazeSwap(getContract<IBlazeSwapRouter>(context.provider, dex.address, "IBlazeSwap"))
    ))
  }

  public async init() {
    await Promise.all(this.agentVaults.map(async (agent) => {
      await agent.setConstantData(this.context)
      await agent.setPseudoConstantData(this.context)
    }))
  }

  public async runArbitrage(): Promise<void> {
    // find the best agent from which to liquidate 
    // (by max liquidation and liquidation factor, ignore pool collateral)
    let agentVault: AgentVault | undefined
    let agentArbitrageData: IAgentArbitrageData | undefined
    let agentQuality: bigint | undefined
    for (const agent of this.agentVaults) {
      const data = await agent.checkForAgentArbitrageAndGetData(this.context)
      if (data !== null) {
        const quality = data.maxLiquidation * data.vaultCR.factor
        if (agentQuality === undefined || quality > agentQuality) {
          agentVault = agent
          agentArbitrageData = data
          agentQuality = quality
        }
      }
    }
    if (agentVault === undefined || agentArbitrageData === undefined) return
    // find the best-suitable liquidity pool (by the max profit)
    let liquidityPool: BlazeSwap | undefined
    let argMaxVaultCollateral: bigint | undefined
    let maxLiquidatorProfit: bigint | undefined
    for (const blazeSwap of this.blazeSwaps) {
      const [reserveVaultCollateral, reserveFAsset] = 
        await blazeSwap.getPoolReserves(
          agentArbitrageData.poolCollateralToken, 
          agentArbitrageData.vaultCollateralToken
        )
      const fee = await blazeSwap.getPoolFee(
        agentArbitrageData.poolCollateralToken, 
        agentArbitrageData.vaultCollateralToken
      )
      const assetPriceUSDT = await getAssetPriceInVaultCollateral(
        this.context, 
        agentVault.vaultCollateralSymbol, 
        agentVault.fAssetSymbol, 
        agentVault.fAssetDecimals
      )
      const optimalVaultCollateral = this.getOptimalVaultCollateral(
        agentArbitrageData,
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
        agentArbitrageData.vaultCR.factor, 
        assetPriceUSDT
      )
      if (maxLiquidatorProfit === undefined || liquidatorProfit > maxLiquidatorProfit) {
        liquidityPool = blazeSwap
        argMaxVaultCollateral = optimalVaultCollateral
        maxLiquidatorProfit = liquidatorProfit
      }
    }
    if (liquidityPool === undefined || argMaxVaultCollateral === undefined) return
    // execute arbitrage
    await this.context.liquidator.executeArbitrage(
      this.context.wNat,
      agentVault.fAsset,
      agentVault.vaultCollateral,
      liquidityPool.contract,
      agentVault.assetManager,
      agentVault.contract
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