import { randBigInt, randBigIntInRelRadius } from "../../utils/numeric"
import { lotSizeUba } from "../utils/assets"
import { priceBasedInitialDexReserve, collateralForAgentCr, convertUsd5ToToken, roundUpWithPrecision } from "../../calculations/calculations"
import type { AssetConfig, EcosystemConfig } from "./interfaces"


export class EcosystemFactory {
    // fixed default values
    public defaultDex1FAssetReserve: bigint // dex1 = vault / f-asset
    public defaultDex2VaultReserve: bigint // dex2 = pool / vault
    public defaultDex3PoolReserve: bigint // dex3 = pool / f-asset
    public defaultMintedUBA: bigint // in lots
    // cached ecosystem
    private _baseEcosystem: EcosystemConfig

    constructor(public readonly config: AssetConfig) {
        // customly configured reserves and minted f-assets (by their value in usd5)
        const defaultDex1LiquidityUsd5 = BigInt(10) ** BigInt(5 + 9) // billion$
        const defaultDex2LiquidityUsd5 = BigInt(10) ** BigInt(5 + 9) // billion$
        const defaultDex3LiquidityUsd5 = BigInt(10) ** BigInt(5 + 9) // billion$
        const defaultMintedFAssetValueUsd5 = BigInt(10) ** BigInt(5 + 6) // million$
        // convert to actual reserves and minted f-assets
        this.defaultDex1FAssetReserve = convertUsd5ToToken(
            defaultDex1LiquidityUsd5,
            config.asset.decimals,
            config.asset.defaultPriceUsd5
        )
        this.defaultDex2VaultReserve = convertUsd5ToToken(
            defaultDex2LiquidityUsd5,
            config.vault.decimals,
            config.vault.defaultPriceUsd5
        )
        this.defaultDex3PoolReserve = convertUsd5ToToken(
            defaultDex3LiquidityUsd5,
            config.pool.decimals,
            config.pool.defaultPriceUsd5
        )
        this.defaultMintedUBA = roundUpWithPrecision(
            convertUsd5ToToken(
                defaultMintedFAssetValueUsd5,
                config.asset.decimals,
                config.asset.defaultPriceUsd5
            ),
            lotSizeUba(config.asset)
        )
        // cache this one to optimize things
        this._baseEcosystem = this.baseEcosystem
    }

    public get baseEcosystem(): EcosystemConfig {
        // set liquidation factors such that reward is half the pool's min cr backing overflow,
        // and it is covered by the pool, while vault covers the exact value of liquidated f-assets
        const liquidationFactorBips = (this.config.pool.minCollateralRatioBips + BigInt(10_000)) / BigInt(2)
        const liquidationFactorVaultBips = BigInt(10_000) // vault covers the value, pool covers reward
        return {
            name: 'base healthy ecosystem config',
            // ftso prices reflect the real ones (in usd5)
            assetFtsoPrice: this.config.asset.defaultPriceUsd5,
            vaultFtsoPrice: this.config.vault.defaultPriceUsd5,
            poolFtsoPrice: this.config.pool.defaultPriceUsd5,
            // dexes are sufficiently liquidated and
            // reserves are aligned with ftso prices
            dex1FAssetReserve: this.defaultDex1FAssetReserve,
            dex1VaultReserve: priceBasedInitialDexReserve(
                this.config.asset.defaultPriceUsd5,
                this.config.vault.defaultPriceUsd5,
                this.config.asset.decimals,
                this.config.vault.decimals,
                this.defaultDex1FAssetReserve
            ),
            dex2VaultReserve: this.defaultDex2VaultReserve,
            dex2PoolReserve: priceBasedInitialDexReserve(
                this.config.vault.defaultPriceUsd5,
                this.config.pool.defaultPriceUsd5,
                this.config.vault.decimals,
                this.config.pool.decimals,
                this.defaultDex2VaultReserve
            ),
            dex3PoolReserve: this.defaultDex3PoolReserve,
            dex3FAssetReserve: priceBasedInitialDexReserve(
                this.config.pool.defaultPriceUsd5,
                this.config.asset.defaultPriceUsd5,
                this.config.pool.decimals,
                this.config.asset.decimals,
                this.defaultDex3PoolReserve
            ),
            // we set agent collateral such that
            // collateral ratios are stable
            mintedUBA: this.defaultMintedUBA,
            vaultCollateral: collateralForAgentCr(
                this.config.vault.minCollateralRatioBips,
                this.defaultMintedUBA,
                this.config.asset.defaultPriceUsd5,
                this.config.vault.defaultPriceUsd5,
                this.config.asset.decimals,
                this.config.vault.decimals
            ),
            poolCollateral: collateralForAgentCr(
                this.config.pool.minCollateralRatioBips,
                this.defaultMintedUBA,
                this.config.asset.defaultPriceUsd5,
                this.config.pool.defaultPriceUsd5,
                this.config.asset.decimals,
                this.config.pool.decimals
            ),
            fullLiquidation: false,
            // asset manager has reasonable liquidation settings
            liquidationFactorBips: liquidationFactorBips,
            liquidationFactorVaultBips: liquidationFactorVaultBips,
            // configs should implicitly set the following data
            expectedVaultCrBips: this.config.vault.minCollateralRatioBips,
            expectedPoolCrBips: this.config.pool.minCollateralRatioBips,
            // initial liquidator contract funds
            initialLiquidatorFAsset: BigInt(1e9),
            initialLiquidatorVault: BigInt(1e9),
            initialLiquidatorPool: BigInt(1e9)
        }
    }

    public get healthyEcosystemWithVaultUnderwater(): EcosystemConfig {
        const vaultCrBips = (this.config.vault.minCollateralRatioBips + BigInt(10_000)) / BigInt(2)
        return {
            ...this._baseEcosystem,
            name: 'vault cr underwater',
            vaultCollateral: collateralForAgentCr(
                vaultCrBips,
                this.defaultMintedUBA,
                this._baseEcosystem.assetFtsoPrice,
                this._baseEcosystem.vaultFtsoPrice,
                this.config.asset.decimals,
                this.config.vault.decimals
            ),
            expectedVaultCrBips: vaultCrBips
        }
    }

    public get healthyEcosystemWithPoolUnderwater(): EcosystemConfig {
        const poolCrBips = (this.config.pool.minCollateralRatioBips + BigInt(10_000)) / BigInt(2)
        return {
            ...this._baseEcosystem,
            name: 'pool cr underwater',
            poolCollateral: collateralForAgentCr(
                poolCrBips,
                this.defaultMintedUBA,
                this._baseEcosystem.assetFtsoPrice,
                this._baseEcosystem.poolFtsoPrice,
                this.config.asset.decimals,
                this.config.pool.decimals
            ),
            expectedPoolCrBips: poolCrBips
        }
    }

    public get healthyEcosystemWithZeroVaultCollateral(): EcosystemConfig {
        return {
            ...this._baseEcosystem,
            name: 'vault cr is 0, pool ftw',
            vaultCollateral: BigInt(0),
            expectedVaultCrBips: BigInt(0)
        }
    }

    public get healthyEcosystemWithZeroPoolCollateral(): EcosystemConfig {
        return {
            ...this._baseEcosystem,
            name: 'pool cr is 0, vault ftw',
            poolCollateral: BigInt(0),
            expectedPoolCrBips: BigInt(0)
        }
    }

    public get semiHealthyEcosystemWithHighSlippage(): EcosystemConfig {
        const fAssetReserves = this.defaultMintedUBA * BigInt(10) / BigInt(9)
        return {
            ...this._baseEcosystem,
            name: 'dex1 has high slippage on vault - f-asset pool',
            // make dex1 f-assets have same price but low liquidity
            dex1FAssetReserve: fAssetReserves,
            dex1VaultReserve: priceBasedInitialDexReserve(
                this.config.asset.defaultPriceUsd5,
                this.config.vault.defaultPriceUsd5,
                this.config.asset.decimals,
                this.config.vault.decimals,
                fAssetReserves
            ),
            // force full liquidation
            vaultCollateral: BigInt(0),
            expectedVaultCrBips: BigInt(0)
        }
    }

    public get unhealthyEcosystemWithHighVaultFAssetDexPrice(): EcosystemConfig {
        return {
            ...this.healthyEcosystemWithVaultUnderwater,
            name: 'too high f-asset price on vault - f-asset pool',
            // make dex f-assets 100x more expensive than on the ftso
            dex1FAssetReserve: this.healthyEcosystemWithVaultUnderwater.dex1FAssetReserve / BigInt(100),
        }
    }

    public get unhealthyEcosystemWithBadDebt(): EcosystemConfig {
        return {
            ...this._baseEcosystem,
            name: 'vault and pool cr combined is below 1, causing bad debt',
            vaultCollateral: collateralForAgentCr(
                BigInt(5000),
                this._baseEcosystem.mintedUBA,
                this._baseEcosystem.assetFtsoPrice,
                this._baseEcosystem.vaultFtsoPrice,
                this.config.asset.decimals,
                this.config.vault.decimals
            ),
            poolCollateral: collateralForAgentCr(
                BigInt(4000),
                this._baseEcosystem.mintedUBA,
                this._baseEcosystem.assetFtsoPrice,
                this._baseEcosystem.poolFtsoPrice,
                this.config.asset.decimals,
                this.config.pool.decimals
            ),
            expectedVaultCrBips: BigInt(5000),
            expectedPoolCrBips: BigInt(4000)
        }
    }

    public getHealthyEcosystems(count: number): EcosystemConfig[] {
        const configs: EcosystemConfig[] = [
            this.healthyEcosystemWithVaultUnderwater,
            this.healthyEcosystemWithPoolUnderwater,
            this.healthyEcosystemWithZeroVaultCollateral,
            this.healthyEcosystemWithZeroPoolCollateral
        ]
        for (let i = 0; i < count - 4; i++) {
            const config = configs[i % 4]
            configs.push(this.randomizeEcosystem(config, `randomized ecosystem ${config.name}`))
        }
        return configs.slice(0, count)
    }

    public getSemiHealthyEcosystems(count: number): EcosystemConfig[] {
        const configs: EcosystemConfig[] = [
            this.semiHealthyEcosystemWithHighSlippage
        ]
        for (let i = 0; i < count - 1; i++) {
            configs.push(this.randomizeEcosystem(
                this.semiHealthyEcosystemWithHighSlippage,
                `randomized semi-healthy ecosystem ${i}`))
        }
        return configs.slice(0, count)
    }

    public getUnhealthyEcosystems(count: number): EcosystemConfig[] {
        const configs: EcosystemConfig[] = [
            this.unhealthyEcosystemWithHighVaultFAssetDexPrice,
            this.unhealthyEcosystemWithBadDebt
        ]
        return configs.slice(0, count)
    }

    protected randomizeEcosystem(ecosystem: EcosystemConfig, name: string): EcosystemConfig {
        // slightly randomized crs (combined ratio must still be > 1)
        const vaultCrBips = randBigInt(
            this.config.vault.minCollateralRatioBips / BigInt(2),
            this.config.vault.minCollateralRatioBips - BigInt(100)
        )
        const poolCrBips = randBigInt(
            this.config.pool.minCollateralRatioBips * BigInt(4) / BigInt(5),
            this.config.vault.minCollateralRatioBips * BigInt(2)
        )
        // slightly randomized ftso prices
        const ftsoPrices = {
            assetFtsoPrice: randBigIntInRelRadius(ecosystem.assetFtsoPrice, 2),
            vaultFtsoPrice: randBigIntInRelRadius(ecosystem.vaultFtsoPrice, 1),
            poolFtsoPrice: randBigIntInRelRadius(ecosystem.poolFtsoPrice, 2),
        }
        // randomized config
        return {
            ...ecosystem,
            ...ftsoPrices,
            name: name,
            // slightly randomized dex reserves
            dex1VaultReserve: randBigIntInRelRadius(ecosystem.dex1VaultReserve, 2),
            dex1FAssetReserve: randBigIntInRelRadius(ecosystem.dex1FAssetReserve, 2),
            dex2PoolReserve: randBigIntInRelRadius(ecosystem.dex2PoolReserve, 2),
            dex2VaultReserve: randBigIntInRelRadius(ecosystem.dex2VaultReserve, 2),
            // slightly randomized minted f-assets
            vaultCollateral: collateralForAgentCr(
                vaultCrBips,
                ecosystem.mintedUBA,
                ftsoPrices.assetFtsoPrice,
                ftsoPrices.vaultFtsoPrice,
                this.config.asset.decimals,
                this.config.vault.decimals
            ),
            poolCollateral: collateralForAgentCr(
                poolCrBips,
                ecosystem.mintedUBA,
                ftsoPrices.assetFtsoPrice,
                ftsoPrices.poolFtsoPrice,
                this.config.asset.decimals,
                this.config.pool.decimals
            ),
            fullLiquidation: Math.random() > 0.5,
            expectedVaultCrBips: vaultCrBips,
            expectedPoolCrBips: poolCrBips
        }
    }
}
