import { ethers } from 'ethers'
import {
  IWNat, FakeERC20, FlashLender, BlazeSwapRouter,
  Liquidator, IIAgentVault, IIAssetManager,
  IFAssetMetadata, FakePriceReader
} from '../../../typechain-ethers'
import { abi as liquidatorAbi } from '../../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as fakeERC20Abi } from '../../../artifacts/fasset/contracts/fasset/mock/FakeERC20.sol/FakeERC20.json'
import { abi as wNatAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IWNat.sol/IWNat.json'
import { abi as flashLenderAbi } from '../../../artifacts/contracts/FlashLender.sol/FlashLender.json'
import { abi as blazeSwapRouterAbi } from '../../../artifacts/blazeswap/contracts/periphery/BlazeSwapRouter.sol/BlazeSwapRouter.json'
import { abi as agentAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAgentVault.sol/IIAgentVault.json'
import { abi as assetManagerAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAssetManager.sol/IIAssetManager.json'
import { abi as fAssetAbi } from '../../../artifacts/contracts/interface/IIFAsset.sol/IFAssetMetadata.json'
import { abi as fakePriceReaderAbi } from '../../../artifacts/fasset/contracts/fasset/mock/FakePriceReader.sol/FakePriceReader.json'

export interface AddressesJson {
  wNat: string
  usdc: string
  assetManagerController: string
  blazeSwapRouter: string
  flashLender: string
  liquidator: string
}

export interface BaseContracts {
  wNat: IWNat
  usdc: FakeERC20
  blazeSwapRouter: BlazeSwapRouter
  flashLender: FlashLender
  liquidator: Liquidator
  assetManagerController?: any
}

export interface AgentContracts {
  agent: IIAgentVault
  assetManager: IIAssetManager
  fAsset: IFAssetMetadata
  priceReader: FakePriceReader
}

export interface EcosystemContracts extends BaseContracts, AgentContracts {}

export function getAddresses(network: string): AddressesJson {
  const addresses = require(`../../addresses.json`)
  return addresses[network]
}

export function getContracts(
  network: string,
  provider: ethers.JsonRpcProvider
): BaseContracts {
  const address = getAddresses(network)
  return {
    wNat: new ethers.Contract(address.wNat, wNatAbi, provider) as unknown as IWNat,
    usdc: new ethers.Contract(address.usdc, fakeERC20Abi, provider) as unknown as FakeERC20,
    blazeSwapRouter: new ethers.Contract(address.blazeSwapRouter, blazeSwapRouterAbi, provider) as unknown as BlazeSwapRouter,
    flashLender: new ethers.Contract(address.flashLender, flashLenderAbi, provider) as unknown as FlashLender,
    liquidator: new ethers.Contract(address.liquidator, liquidatorAbi, provider) as unknown as Liquidator
  }
}

export async function getAgentContracts(
  agentAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<AgentContracts> {
  const agent = new ethers.Contract(agentAddress, agentAbi, provider) as unknown as IIAgentVault
  const assetManagerAddress = await agent.assetManager()
  const assetManager = new ethers.Contract(assetManagerAddress, assetManagerAbi, provider) as unknown as IIAssetManager
  const settings = await assetManager.getSettings()
  const fAsset = new ethers.Contract(settings.fAsset, fAssetAbi, provider) as unknown as IFAssetMetadata
  const priceReader = new ethers.Contract(settings.priceReader, fakePriceReaderAbi, provider) as unknown as FakePriceReader
  return { agent, assetManager, fAsset, priceReader }
}