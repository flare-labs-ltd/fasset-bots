import { ethers } from 'hardhat'
import { AssetConfig } from './interfaces'
import { lotSizeAmg } from '../utils/assets'
import deployUniswapV2 from './dexes'
import type { ContractFactories, TestContracts, TestContext, TestSigners } from './interfaces'


export async function getFactories(): Promise<ContractFactories> {
  return {
    flashLender: await ethers.getContractFactory("FlashLender"),
    assetManager: await ethers.getContractFactory("AssetManagerMock"),
    priceReader: await ethers.getContractFactory("FakePriceReader"),
    agent: await ethers.getContractFactory("AgentMock"),
    fAsset: await ethers.getContractFactory("ERC20Mock"),
    vault: await ethers.getContractFactory("ERC20Mock"),
    pool: await ethers.getContractFactory("ERC20Mock"),
    liquidator: await ethers.getContractFactory("Liquidator"),
    challenger: await ethers.getContractFactory("Challenger"),
  }
}

export async function getSigners(): Promise<TestSigners> {
  const signers = await ethers.getSigners()
  const deployer = signers[0]
  const challenger = signers[10]
  const liquidator = signers[11]
  const rewardee = signers[12]
  const fAssetMinter = signers[13]
  return { deployer, challenger, liquidator, fAssetMinter, rewardee }
}

export async function getContracts(
  assetConfig: AssetConfig,
  signers: TestSigners
): Promise<TestContracts> {
  const contracts = {} as TestContracts
  const factories = await getFactories()
  // set mock tokens
  contracts.fAsset = await factories.fAsset.deploy(assetConfig.asset.symbol, assetConfig.asset.symbol, assetConfig.asset.decimals)
  contracts.vault = await factories.vault.deploy(assetConfig.vault.name, assetConfig.vault.symbol, assetConfig.vault.decimals)
  contracts.pool = await factories.pool.deploy(assetConfig.pool.name, assetConfig.pool.symbol, assetConfig.pool.decimals)
  // set up price reader
  contracts.priceReader = await factories.priceReader.deploy(signers.deployer)
  await contracts.priceReader.setDecimals(assetConfig.asset.ftsoSymbol, assetConfig.asset.ftsoDecimals)
  await contracts.priceReader.setDecimals(assetConfig.vault.ftsoSymbol, assetConfig.vault.ftsoDecimals)
  await contracts.priceReader.setDecimals(assetConfig.pool.ftsoSymbol, assetConfig.pool.ftsoDecimals)
  // set asset manager
  contracts.assetManager = await factories.assetManager.deploy(
    contracts.pool,
    contracts.fAsset,
    contracts.priceReader,
    lotSizeAmg(assetConfig.asset),
    assetConfig.asset.amgDecimals,
    assetConfig.vault.minCollateralRatioBips,
    assetConfig.pool.minCollateralRatioBips,
    assetConfig.asset.ftsoSymbol,
    assetConfig.vault.ftsoSymbol,
    assetConfig.pool.ftsoSymbol
  )
  // set agent
  contracts.agent = await factories.agent.deploy(contracts.assetManager, contracts.vault)
  // set up uniswap-v2 implementation
  contracts.uniswapV2 = await deployUniswapV2(contracts.pool, signers.deployer)
  // set up flash loans
  contracts.flashLender = await factories.flashLender.deploy()
  await contracts.vault.mint(contracts.flashLender, ethers.MaxUint256 / BigInt(100))
  // set liquidator and challenger
  contracts.liquidator = await factories.liquidator.connect(signers.liquidator).deploy(contracts.flashLender, contracts.uniswapV2)
  contracts.challenger = await factories.challenger.connect(signers.challenger).deploy(contracts.flashLender, contracts.uniswapV2)
  return contracts
}

export async function getTestContext(assetConfig: AssetConfig): Promise<TestContext> {
  const signers = await getSigners()
  const contracts = await getContracts(assetConfig, signers)
  return { signers, contracts }
}