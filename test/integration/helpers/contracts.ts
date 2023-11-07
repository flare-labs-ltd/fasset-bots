import { ethers } from 'ethers'
import { waitFinalize } from './utils'
import { abi as fakeERC20Abi } from '../../../artifacts/fasset/contracts/fasset/mock/FakeERC20.sol/FakeERC20.json'
import { abi as wNatAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IWNat.sol/IWNat.json'
import { abi as flashLenderAbi } from '../../../artifacts/contracts/FlashLender.sol/FlashLender.json'
import { abi as blazeSwapRouterAbi } from '../../../artifacts/blazeswap/contracts/periphery/BlazeSwapRouter.sol/BlazeSwapRouter.json'
import { abi as agentAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAgentVault.sol/IIAgentVault.json'
import { abi as assetManagerAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAssetManager.sol/IIAssetManager.json'
import { abi as fAssetAbi } from '../../../artifacts/contracts/interface/IIFAsset.sol/IFAssetMetadata.json'
import { abi as fakePriceReaderAbi } from '../../../artifacts/fasset/contracts/fasset/mock/FakePriceReader.sol/FakePriceReader.json'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import type { NetworkAddressesJson, AddressesJson, BaseContracts, FAssetContracts, Contracts } from './interface'
import type { IBlazeSwapRouter, IERC3156FlashLender, IIAgentVault, Liquidator } from '../../../types'


export function getAddresses(network: string): NetworkAddressesJson {
  const addresses = require(`../../../addresses.json`) as AddressesJson
  return addresses[network]
}

export function getBaseContracts(network: string, provider: ethers.JsonRpcProvider): BaseContracts {
  const address = getAddresses(network)
  return {
    wNat: new ethers.Contract(address.wNat, wNatAbi, provider) as any,
    usdc: new ethers.Contract(address.usdc, fakeERC20Abi, provider) as any,
    blazeSwapRouter: new ethers.Contract(address.blazeSwapRouter, blazeSwapRouterAbi, provider) as any,
    flashLender: new ethers.Contract(address.flashLender, flashLenderAbi, provider) as any,
    liquidator: new ethers.Contract(address.liquidator, liquidatorAbi, provider) as any
  }
}

export async function getFAssetContracts(
  assetManagerAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<FAssetContracts> {
  const assetManager = new ethers.Contract(assetManagerAddress, assetManagerAbi, provider) as any
  const settings = await assetManager.getSettings()
  const fAsset = new ethers.Contract(settings.fAsset, fAssetAbi, provider) as any
  const priceReader = new ethers.Contract(settings.priceReader, fakePriceReaderAbi, provider) as any
  return { assetManager, fAsset, priceReader }
}

export async function getContracts(
  assetManagerAddress: string,
  network: string,
  provider: ethers.JsonRpcProvider
): Promise<Contracts> {
  const ecosystemContracts = getBaseContracts(network, provider)
  const fAssetContracts = await getFAssetContracts(assetManagerAddress, provider)
  return { ...ecosystemContracts, ...fAssetContracts }
}

export async function getAgentsAssetManager(
  agentAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<string> {
  const agent: IIAgentVault = new ethers.Contract(agentAddress, agentAbi, provider) as any
  return agent.assetManager()
}

export async function deployLiquidator(
  flashLender: IERC3156FlashLender,
  blazeSwapRouter: IBlazeSwapRouter,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<Liquidator> {
  const factory = new ethers.ContractFactory(liquidatorAbi, liquidatorBytecode, signer)
  // @ts-ignore deploy not returning a transaction response
  return waitFinalize(provider, signer, factory.connect(signer).deploy(flashLender, blazeSwapRouter)) as any
}