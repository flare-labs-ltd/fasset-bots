import type {
  IWNat, FakeERC20, FlashLender, BlazeSwapRouter,
  Liquidator, IIAgentVault, IIAssetManager,
  IFAssetMetadata, FakePriceReader
} from '../../../types'


export interface AddressesJson {
  [network: string]: NetworkAddressesJson
}

export interface NetworkAddressesJson {
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