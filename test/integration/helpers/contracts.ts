import { ethers } from 'ethers'
import { abi as liquidatorAbi } from '../../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as fakeERC20Abi } from '../../../artifacts/fasset/contracts/fasset/mock/FakeERC20.sol/FakeERC20.json'
import { abi as wNatAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IWNat.sol/IWNat.json'
import { abi as flashLenderAbi } from '../../../artifacts/contracts/FlashLender.sol/FlashLender.json'
import { abi as blazeSwapRouterAbi } from '../../../artifacts/blazeswap/contracts/periphery/BlazeSwapRouter.sol/BlazeSwapRouter.json'
import { abi as agentAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAgentVault.sol/IIAgentVault.json'
import { abi as assetManagerAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAssetManager.sol/IIAssetManager.json'
import { abi as fAssetAbi } from '../../../artifacts/contracts/interface/IIFAsset.sol/IFAssetMetadata.json'
import { abi as fakePriceReaderAbi } from '../../../artifacts/fasset/contracts/fasset/mock/FakePriceReader.sol/FakePriceReader.json'
import { NetworkAddressesJson, AddressesJson, BaseContracts, AgentContracts } from './interface'


export function getAddresses(network: string): NetworkAddressesJson {
  const addresses = require(`../../../addresses.json`) as AddressesJson
  return addresses[network]
}

export function getContracts(
  network: string,
  provider: ethers.JsonRpcProvider
): BaseContracts {
  const address = getAddresses(network)
  return {
    wNat: new ethers.Contract(address.wNat, wNatAbi, provider) as any,
    usdc: new ethers.Contract(address.usdc, fakeERC20Abi, provider) as any,
    blazeSwapRouter: new ethers.Contract(address.blazeSwapRouter, blazeSwapRouterAbi, provider) as any,
    flashLender: new ethers.Contract(address.flashLender, flashLenderAbi, provider) as any,
    liquidator: new ethers.Contract(address.liquidator, liquidatorAbi, provider) as any
  }
}

export async function getAgentContracts(
  agentAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<AgentContracts> {
  const agent = new ethers.Contract(agentAddress, agentAbi, provider) as any
  const assetManagerAddress = await agent.assetManager()
  const assetManager = new ethers.Contract(assetManagerAddress, assetManagerAbi, provider) as any
  const settings = await assetManager.getSettings()
  const fAsset = new ethers.Contract(settings.fAsset, fAssetAbi, provider) as any
  const priceReader = new ethers.Contract(settings.priceReader, fakePriceReaderAbi, provider) as any
  return { agent, assetManager, fAsset, priceReader }
}