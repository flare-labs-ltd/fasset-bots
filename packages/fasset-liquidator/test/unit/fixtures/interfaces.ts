import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type {
    FlashLender__factory, ERC20Mock__factory,
    AssetManagerMock__factory, AgentMock__factory, FakePriceReader__factory,
    Liquidator__factory, Challenger__factory,
    IUniswapV2Router, FlashLender, FakePriceReader, ERC20Mock, AssetManagerMock,
    AgentMock, Liquidator, Challenger
} from '../../../types'


////////////////////////////////////////////////////////////////////////
// unit testing config interfaces

export interface Asset {
    name: string
    symbol: string
    decimals: bigint
    ftsoSymbol: string
    ftsoDecimals: bigint
    defaultPriceUsd5: bigint
}

export interface CollateralAsset extends Asset {
    kind: "vault" | "pool"
    minCollateralRatioBips: bigint
}

export interface UnderlyingAsset extends Asset {
    amgDecimals: bigint
    lotSize: bigint
}

export interface AssetConfig {
    asset: UnderlyingAsset
    vault: CollateralAsset
    pool: CollateralAsset
}

export interface EcosystemConfig {
    name: string
    // ftso prices
    assetFtsoPrice: bigint
    vaultFtsoPrice: bigint
    poolFtsoPrice: bigint
    // dex(vault, f-asset)
    dex1VaultReserve: bigint
    dex1FAssetReserve: bigint
    // dex(pool, vault)
    dex2PoolReserve: bigint
    dex2VaultReserve: bigint
    // dex(f-asset, pool) - needed only for testing swaps through non-arbitrary paths
    dex3FAssetReserve: bigint
    dex3PoolReserve: bigint
    // agent settings
    mintedUBA: bigint
    vaultCollateral: bigint
    poolCollateral: bigint
    fullLiquidation: boolean
    // asset manager settings
    liquidationFactorBips: bigint
    liquidationFactorVaultBips: bigint
    // initial liquidator funds
    initialLiquidatorFAsset: bigint
    initialLiquidatorVault: bigint
    initialLiquidatorPool: bigint
    // expected implicit data
    expectedVaultCrBips: bigint
    expectedPoolCrBips: bigint
}

////////////////////////////////////////////////////////////////////////
// unit testing context interfaces

// uniswap-v2 factory is dynamic
export interface ContractFactories {
    // flash loan
    flashLender: FlashLender__factory
    // f-asset system
    assetManager: AssetManagerMock__factory
    priceReader: FakePriceReader__factory
    agent: AgentMock__factory
    // tokens
    fAsset: ERC20Mock__factory
    vault: ERC20Mock__factory
    pool: ERC20Mock__factory
    // liquidator / challenger
    liquidator: Liquidator__factory
    challenger: Challenger__factory
}

export interface TestContracts {
    priceReader: FakePriceReader
    assetManager: AssetManagerMock
    fAsset: ERC20Mock
    vault: ERC20Mock
    pool: ERC20Mock
    agent: AgentMock
    uniswapV2: IUniswapV2Router
    flashLender: FlashLender
    liquidator: Liquidator
    challenger: Challenger
}

export interface TestSigners {
    deployer: HardhatEthersSigner
    challenger: HardhatEthersSigner
    liquidator: HardhatEthersSigner
    rewardee: HardhatEthersSigner
    fAssetMinter: HardhatEthersSigner
}

export interface TestContext {
    signers: TestSigners
    contracts: TestContracts
}
