import type {
  IWNat, FakeERC20, FlashLender, IUniswapV2Router, IUniswapV2Pair,
  Liquidator, IIAssetManager, IERC20Metadata, FakePriceReader
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
  uniswapV2: IUniswapV2Router
  flashLender: FlashLender
}

export interface FAssetContracts {
  assetManager: IIAssetManager
  fAsset: IERC20Metadata
  priceReader: FakePriceReader
}

// all relevant contracts to the system or testing
export interface Contracts extends BaseContracts, FAssetContracts {
  dex1Token: IUniswapV2Pair
  dex2Token: IUniswapV2Pair
}