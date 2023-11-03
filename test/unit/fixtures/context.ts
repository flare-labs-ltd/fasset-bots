import { ethers } from 'hardhat'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import { AssetConfig } from './interface'
import { lotSizeAmg } from '../helpers/utils'
import type { ContractFactories, Contracts, ContractContext } from './interface'


export async function getFactories(): Promise<ContractFactories> {
  return {
    flashLender: await ethers.getContractFactory("FlashLender"),
    blazeSwapManager: await ethers.getContractFactory("BlazeSwapManager"),
    blazeSwapFactory: await ethers.getContractFactory("BlazeSwapBaseFactory"),
    blazeSwapRouter: await ethers.getContractFactory("BlazeSwapRouter"),
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

export async function getContracts(
  assetConfig: AssetConfig,
  deployer: HardhatEthersSigner,
  challenger: HardhatEthersSigner,
  liquidator: HardhatEthersSigner
): Promise<Contracts> {
  const contracts = {} as Contracts
  const factories = await getFactories()
  // set mock tokens
  contracts.fAsset = await factories.fAsset.deploy(assetConfig.asset.symbol, assetConfig.asset.symbol, assetConfig.asset.decimals)
  contracts.vault = await factories.vault.deploy(assetConfig.vault.name, assetConfig.vault.symbol, assetConfig.vault.decimals)
  contracts.pool = await factories.pool.deploy(assetConfig.pool.name, assetConfig.pool.symbol, assetConfig.pool.decimals)
  // set up price reader
  contracts.priceReader = await factories.priceReader.deploy(deployer)
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
  // set up blazeswap
  const blazeSwapManager = await factories.blazeSwapManager.deploy(deployer)
  const blazeSwapFactory = await factories.blazeSwapFactory.deploy(blazeSwapManager)
  await blazeSwapManager.setFactory(blazeSwapFactory)
  contracts.blazeSwapRouter = await factories.blazeSwapRouter.deploy(blazeSwapFactory, contracts.pool, false)
  // set up flash loans
  contracts.flashLender = await factories.flashLender.deploy(contracts.vault)
  await contracts.vault.mint(contracts.flashLender, ethers.MaxUint256 / BigInt(10))
  // set liquidator and challenger
  contracts.liquidator = await factories.liquidator.connect(liquidator).deploy(contracts.flashLender, contracts.blazeSwapRouter)
  contracts.challenger = await factories.challenger.connect(challenger).deploy(contracts.flashLender, contracts.blazeSwapRouter)
  return contracts
}

export async function getContractContext(assetConfig: AssetConfig): Promise<ContractContext> {
  const context = {} as ContractContext
  // define signers
  const signers = await ethers.getSigners()
  context.deployer = signers[0]
  context.challenger = signers[10]
  context.liquidator = signers[11]
  context.fAssetMinter = signers[12]
  // define asset config
  context.contracts = await getContracts(assetConfig, context.deployer, context.challenger, context.liquidator)
  return context
}