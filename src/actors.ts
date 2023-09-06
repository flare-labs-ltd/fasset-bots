import { IFAsset, IAssetManager, IBlazeSwapRouter, ILiquidationStrategy, IERC20Metadata, IFAssetMetadata, IIAgentVault } from '../typechain-ethers'
import { AgentInfo, AssetManagerSettings, CollateralType } from '../typechain/fasset/contracts/userInterfaces/IAssetManager'
import { AgentArbitrageData, LiquidationPhase, AgentStatus, Context } from './interface'
import { getContract, min } from './util'

export class AgentVault {
  // constants
  public address!: string
  public assetManager!: IAssetManager
  public fAsset!: IFAssetMetadata
  public fAssetDecimals!: bigint
  public fAssetSymbol!: string
  // cache
  public vaultCollateral!: IERC20Metadata
  public vaultCollateralSymbol!: string
  public vaultCollateralType!: CollateralType.DataStructOutput
  public poolCollateralType!: CollateralType.DataStructOutput
  public liquidationStrategy!: ILiquidationStrategy
  public assetManagerSettings!: AssetManagerSettings.DataStructOutput

  constructor(public contract: IIAgentVault) {}

  // these variables getting updated means f-asset is screwed
  public async setConstantData(context: Context): Promise<void> {
    this.address = await this.contract.getAddress()
    this.assetManager = getContract<IAssetManager>(
      context.provider, await this.contract.assetManager(), "IAssetManager")
    this.fAsset = getContract<IFAssetMetadata>(
      context.provider, await this.assetManager.fAsset(), "IFAsset")
    this.fAssetSymbol = await this.fAsset.symbol()
    this.fAssetDecimals = await this.fAsset.decimals()
  }

  // these variables can get updated as part of normal (but rare) operation
  public async setPseudoConstantData(context: Context): Promise<void> {
    const agentInfo = await this.assetManager.getAgentInfo(this.address)
    this.vaultCollateral = getContract<IERC20Metadata>(
      context.provider, agentInfo.vaultCollateralToken, "IERC20Metadata")
    this.vaultCollateralSymbol = await this.vaultCollateral.symbol()
    this.vaultCollateralType = await this.assetManager.getCollateralType(
      1, agentInfo.vaultCollateralToken)
    this.poolCollateralType = await this.assetManager.getCollateralType(
      2, context.addresses.wNat)
    this.assetManagerSettings = await this.assetManager.getSettings()
  }

  public async checkForAgentArbitrageAndGetData(context: Context): Promise<AgentArbitrageData | null> {
    const agentInfo = await this.assetManager.getAgentInfo(await this.contract.getAddress())
    const status = Number(agentInfo.status)
    if (
      AgentStatus[status] == "CBB" || 
      AgentStatus[status] == "FULL_LIQUIDATION" || 
      AgentStatus[status] == "LIQUIDATION"
    ) return this.getAgentArbitrageData(context, agentInfo)
    return null
  }

  // get data relevant to doing an arbitrage with a liquidity pool
  protected async getAgentArbitrageData(
    context: Context, agentInfo: AgentInfo.InfoStructOutput
  ): Promise<AgentArbitrageData> {
    const { _c1FactorBIPS, _poolFactorBIPS } = 
      await context.liquidationStrategy.currentLiquidationFactorBIPS(
        this.address, 
        agentInfo.vaultCollateralRatioBIPS, 
        agentInfo.poolCollateralRatioBIPS
      )
    const vaultTargetCR = this.targetRatioForCollateral(
      this.vaultCollateralType, agentInfo.vaultCollateralRatioBIPS)
    const poolTargetCR = this.targetRatioForCollateral(
      this.poolCollateralType, agentInfo.poolCollateralRatioBIPS)
    const vaultMaxLiquidated = this.maxLiquidatedAmountForCollateral(
      agentInfo, agentInfo.vaultCollateralRatioBIPS, vaultTargetCR, _c1FactorBIPS)
    const poolMaxLiquidated = this.maxLiquidatedAmountForCollateral(
      agentInfo, agentInfo.poolCollateralRatioBIPS, poolTargetCR, _poolFactorBIPS)
    return {
      vaultCollateralToken: agentInfo.vaultCollateralToken,
      poolCollateralToken: context.addresses.wNat,
      minted: agentInfo.mintedUBA,
      vaultCR: {
        current: agentInfo.vaultCollateralRatioBIPS,
        target: vaultTargetCR,
        factor: _c1FactorBIPS
      },
      poolCR: {
        current: agentInfo.poolCollateralRatioBIPS,
        target: poolTargetCR,
        factor: _poolFactorBIPS
      },
      liquidationStatus: Number(agentInfo.status),
      maxLiquidation: min(poolMaxLiquidated, vaultMaxLiquidated)
    }
  }

  protected maxLiquidatedAmountForCollateral(
    agentInfo: AgentInfo.InfoStructOutput,
    collateralRatioBIPS: bigint,
    targetRatioBIPS: bigint,
    liquidationFactorBIPS: bigint
  ): bigint {
    const status = Number(agentInfo.status)
    // for full liquidation, all minted amount can be liquidated
    if (AgentStatus[status] == "FULL_LIQUIDATION") {
      return agentInfo.mintedUBA
    }
    // otherwise, liquidate just enough to get agent to safety
    if (targetRatioBIPS <= collateralRatioBIPS) 
      return BigInt(0)
    if (collateralRatioBIPS <= liquidationFactorBIPS) 
      return agentInfo.mintedUBA
    
    const mintedAMG = agentInfo.mintedUBA / this.assetManagerSettings.assetMintingGranularityUBA
    const maxLiquidatedAMG= this.divRoundUp(
      mintedAMG * (targetRatioBIPS - collateralRatioBIPS), 
      (targetRatioBIPS - liquidationFactorBIPS)
    )
    const maxLiquidatedLots = this.roundUpAmgToLot(maxLiquidatedAMG)
    const maxLiquidatedUBA = this.lotsToUBA(maxLiquidatedLots)
    return maxLiquidatedUBA > agentInfo.mintedUBA ? agentInfo.mintedUBA : maxLiquidatedUBA
  }

  protected targetRatioForCollateral(
    collateral: CollateralType.DataStructOutput,
    collateralRatioBIPS: bigint
  ): bigint {
    const liquidationPhase = this.liquidationPhaseForCollateral(collateral, collateralRatioBIPS)
    // should have || !_agent.collateralUnderwater(_collateralKind), but can't derive the value
    if (liquidationPhase == LiquidationPhase.CCB) {
        return collateral.minCollateralRatioBIPS;
    } else {
        return collateral.safetyMinCollateralRatioBIPS;
    }
  }

  protected liquidationPhaseForCollateral(
    collateral: CollateralType.DataStructOutput,
    collateralRatioBIPS: bigint
  ): number {
    if (collateralRatioBIPS >= collateral.minCollateralRatioBIPS) {
      return LiquidationPhase.NONE;
    } else if (collateralRatioBIPS >= collateral.ccbMinCollateralRatioBIPS) {
        return LiquidationPhase.CCB;
    } else {
        return LiquidationPhase.LIQUIDATION;
    }
  }

  private divRoundUp(a: bigint, b: bigint): bigint {
    return (a + b - BigInt(1)) / b
  }

  private roundUpAmgToLot(amg: bigint): bigint {
    return (amg + this.assetManagerSettings.lotSizeAMG - BigInt(1)) 
      / this.assetManagerSettings.lotSizeAMG
  }

  private lotsToUBA(lots: bigint): bigint {
    return lots * this.assetManagerSettings.lotSizeAMG 
      * this.assetManagerSettings.assetMintingGranularityUBA
  }
}

export class BlazeSwap {
  constructor(public contract: IBlazeSwapRouter) {}

  public getPoolReserves(tokenA: string, tokenB: string): Promise<[bigint, bigint]> {
    return this.contract.getReserves(tokenA, tokenB)
  }

  public getPoolFee(tokenA: string, tokenB: string): Promise<bigint> {
    return new Promise(() => BigInt(300)) // for uniswap this 0.3% is hardcoded
  }
}