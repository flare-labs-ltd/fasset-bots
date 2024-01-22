import { ethers } from 'ethers'
import { waitFinalize } from './utils'
import { abi as fakeERC20Abi } from '../../../artifacts/fasset/contracts/fasset/mock/FakeERC20.sol/FakeERC20.json'
import { abi as wNatAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IWNat.sol/IWNat.json'
import { abi as flashLenderAbi } from '../../../artifacts/contracts/FlashLender.sol/FlashLender.json'
import { abi as agentAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAgentVault.sol/IIAgentVault.json'
import { abi as assetManagerAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAssetManager.sol/IIAssetManager.json'
import { abi as erc20MetadataAbi } from '../../../artifacts/@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol/IERC20Metadata.json'
import { abi as uniswapV2RouterAbi } from '../../../artifacts/contracts/interface/IUniswapV2/IUniswapV2Router.sol/IUniswapV2Router.json'
import { abi as uniswapV2PairAbi } from '../../../artifacts/contracts/interface/IUniswapV2/IUniswapV2Pair.sol/IUniswapV2Pair.json'
import { abi as fakePriceReaderAbi } from '../../../artifacts/fasset/contracts/fasset/mock/FakePriceReader.sol/FakePriceReader.json'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import type { NetworkAddressesJson, AddressesJson, BaseContracts, FAssetContracts, Contracts } from './interface'
import type { IUniswapV2Router, IERC3156FlashLender, IIAgentVault, Liquidator } from '../../../types'


export function getAddresses(network: string): NetworkAddressesJson {
  const addresses = require(`../../../addresses.json`) as AddressesJson
  return addresses[network]
}

export function getBaseContracts(network: string, provider: ethers.JsonRpcProvider): BaseContracts {
  const address = getAddresses(network)
  return {
    wNat: new ethers.Contract(address.wNat, wNatAbi, provider) as any,
    usdc: new ethers.Contract(address.usdc, fakeERC20Abi, provider) as any,
    uniswapV2: new ethers.Contract(address.blazeSwapRouter, uniswapV2RouterAbi, provider) as any,
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
  const fAsset = new ethers.Contract(settings.fAsset, erc20MetadataAbi, provider) as any
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
  const contracts = { ...ecosystemContracts, ...fAssetContracts }
  const pair1 = await contracts.uniswapV2.pairFor(contracts.fAsset, contracts.usdc)
  const pair2 = await contracts.uniswapV2.pairFor(contracts.wNat, contracts.usdc)
  const dex1Token = new ethers.Contract(pair1, uniswapV2PairAbi, provider) as any
  const dex2Token = new ethers.Contract(pair2, uniswapV2PairAbi, provider) as any
  return { ...contracts, dex1Token, dex2Token }
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
  blazeSwapRouter: IUniswapV2Router,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<Liquidator> {
  const factory = new ethers.ContractFactory(liquidatorAbi, liquidatorBytecode, signer)
  // @ts-ignore deploy not returning a transaction response
  return waitFinalize(provider, signer, factory.connect(signer).deploy(flashLender, blazeSwapRouter)) as any
}