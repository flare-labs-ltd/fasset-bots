import type {
    IWNat, FlashLender, IUniswapV2Router,
    IIAssetManager, IERC20Metadata, FakePriceReader, FakeERC20
} from '../../../../types'

/**
 * All integration tests are based on the coston network,
 * because of the need for fake price provider.
 * Except uniswap-v2 tests, which will be needed to
 * test the compatibility of the chosen uniswap-v2-based router.
 */

export interface BaseContracts {
    collaterals: { [name: string]: FakeERC20 }
    wNat: IWNat & IERC20Metadata
    uniswapV2: IUniswapV2Router
    flashLender: FlashLender
}

export interface FAssetContracts {
    assetManager: IIAssetManager
    fAsset: IERC20Metadata
    priceReader: FakePriceReader
}

// all relevant contracts to the system or testing
export interface Contracts extends BaseContracts, FAssetContracts { }
