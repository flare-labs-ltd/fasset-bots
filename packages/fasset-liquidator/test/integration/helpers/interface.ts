import type {
    IWNat, FlashLender, IUniswapV2Router, IUniswapV2Pair,
    IIAssetManager, IERC20Metadata, FakePriceReader
} from '../../../types'


export interface AddressesJson {
    [network: string]: NetworkAddressesJson
}

export interface NetworkAddressesJson {
    wNat: string
    usdc: string
    usdt: string
    eth: string
    uniswapV2: string
    flashLender: string
}

export interface BaseContracts {
    wNat: IWNat & IERC20Metadata
    usdc: IERC20Metadata
    usdt: IERC20Metadata
    eth: IERC20Metadata
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