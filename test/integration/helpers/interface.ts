import type {
  IWNat, FakeERC20, FlashLender, BlazeSwapRouter, IBlazeSwapPair,
  Liquidator, IIAssetManager, IFAssetMetadata, FakePriceReader
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
}

export interface FAssetContracts {
  assetManager: IIAssetManager
  fAsset: IFAssetMetadata
  priceReader: FakePriceReader
}

// all relevant contracts to the system or testing
export interface Contracts extends BaseContracts, FAssetContracts {
  dex1Token: IBlazeSwapPair
  dex2Token: IBlazeSwapPair
}