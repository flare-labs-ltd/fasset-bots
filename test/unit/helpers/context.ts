import { expect } from 'chai'
import { liquidationOutput, amgToTokenPrice, dexMinPriceFromMaxSlippage } from '../../calculations'
import { ubaToAmg } from './utils'
import { addLiquidity, swapOutput, swapOutputs } from './dex'
import type { EcosystemConfig, AssetConfig, TestContext } from '../fixtures/interface'
import type { ERC20 } from '../../../types'


export class ContextUtils {

  constructor(
    private assetConfig: AssetConfig,
    private context: TestContext
  ) {}

  async configureEcosystem(config: EcosystemConfig): Promise<void> {
    const { contracts, signers } = this.context
    const { assetManager, blazeSwapRouter, fAsset, vault, pool, agent } = contracts
    // set ftso prices and dex reserves (pool-fAsset is needed only for testing swaps through non-arbitrary paths)
    await assetManager.setLiquidationFactors(config.liquidationFactorBips, config.liquidationFactorVaultBips)
    await this.setFtsoPrices(config.assetFtsoPrice, config.vaultFtsoPrice, config.poolFtsoPrice)
    await addLiquidity(blazeSwapRouter, vault, fAsset, config.dex1VaultReserve, config.dex1FAssetReserve, signers.deployer)
    await addLiquidity(blazeSwapRouter, pool, vault, config.dex2PoolReserve, config.dex2VaultReserve, signers.deployer)
    await addLiquidity(blazeSwapRouter, pool, fAsset, config.dex3PoolReserve, config.dex3FAssetReserve, signers.deployer)
    // deposit collaterals and mint
    await agent.depositVaultCollateral(config.vaultCollateral)
    await agent.depositPoolCollateral(config.poolCollateral)
    await agent.mint(signers.fAssetMinter, config.mintedUBA)
    // put agent in full liquidation if configured so (this implies agent did an illegal operation)
    if (config.fullLiquidation) await assetManager.putAgentInFullLiquidation(agent)
    const { status, vaultCollateralRatioBIPS, poolCollateralRatioBIPS } = await assetManager.getAgentInfo(agent)
    expect(status).to.equal(config.fullLiquidation ? 3 : 0)
    // check that agent cr is as expected
    expect(vaultCollateralRatioBIPS).to.be.closeTo(config.expectedVaultCrBips, 1)
    expect(poolCollateralRatioBIPS).to.be.closeTo(config.expectedPoolCrBips, 1)
    // mint some initial funds to the liquidator contract
    await contracts.fAsset.mint(contracts.liquidator, config.initialLiquidatorFAsset)
    await contracts.vault.mint(contracts.liquidator, config.initialLiquidatorVault)
    await contracts.pool.mint(contracts.liquidator, config.initialLiquidatorPool)
  }

  // prices expressed in e.g. usd
  async setFtsoPrices(
    priceAsset: bigint,
    priceVault: bigint,
    pricePool: bigint
  ): Promise<void> {
    const priceReader = this.context.contracts.priceReader
    await priceReader.setPrice(this.assetConfig.asset.ftsoSymbol, priceAsset)
    await priceReader.setPrice(this.assetConfig.vault.ftsoSymbol, priceVault)
    await priceReader.setPrice(this.assetConfig.pool.ftsoSymbol, pricePool)
  }

  async arbitrageProfit(liquidatedVault: bigint, dex1Path: ERC20[], dex2Path: ERC20[]): Promise<bigint> {
    const { contracts } = this.context
    const fAssets = await swapOutput(contracts.blazeSwapRouter, dex1Path, liquidatedVault)
    const [vaultProfit, poolProfit] = await this.liquidationOutput(fAssets)
    const [, poolProfitSwapped] = await swapOutputs(
      contracts.blazeSwapRouter, [dex1Path, dex2Path], [liquidatedVault, poolProfit])
    return vaultProfit + poolProfitSwapped - liquidatedVault
  }

  async dexMinPriceFromMaxSlippage(slippageBips: number, tokenA: ERC20, tokenB: ERC20): Promise<[bigint, bigint]> {
    const [tokenAReserve, tokenBReserve] = await this.context.contracts.blazeSwapRouter.getReserves(tokenA, tokenB)
    return dexMinPriceFromMaxSlippage(slippageBips, tokenAReserve, tokenBReserve)
  }

  async liquidationOutput(amountFAsset: bigint): Promise<[bigint, bigint]> {
    const { contracts } = this.context
    const { liquidationPaymentFactorVaultBIPS, liquidationPaymentFactorPoolBIPS }
      = await contracts.assetManager.getAgentInfo(contracts.agent)
    const [assetFtsoPrice,, assetFtsoDecimals] = await contracts.priceReader.getPrice(this.assetConfig.asset.ftsoSymbol)
    const [vaultFtsoPrice,, vaultFtsoDecimals] = await contracts.priceReader.getPrice(this.assetConfig.vault.ftsoSymbol)
    const [poolFtsoPrice,, poolFtsoDecimals] = await contracts.priceReader.getPrice(this.assetConfig.pool.ftsoSymbol)
    const amountFAssetAmg = ubaToAmg(this.assetConfig.asset, amountFAsset)
    return liquidationOutput(
      amountFAssetAmg,
      liquidationPaymentFactorVaultBIPS,
      liquidationPaymentFactorPoolBIPS,
      amgToTokenPrice(
        this.assetConfig.asset.amgDecimals,
        assetFtsoDecimals,
        assetFtsoPrice,
        this.assetConfig.vault.decimals,
        vaultFtsoDecimals,
        vaultFtsoPrice
      ),
      amgToTokenPrice(
        this.assetConfig.asset.amgDecimals,
        assetFtsoDecimals,
        assetFtsoPrice,
        this.assetConfig.pool.decimals,
        poolFtsoDecimals,
        poolFtsoPrice
      )
    )
  }

}
