import BN from "bn.js";
import { IIAssetManagerInstance } from "../../typechain-truffle";
import { AgentInfo, AssetManagerSettings, CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { CollateralPrice } from "../state/CollateralPrice";
import { TokenPriceReader } from "../state/TokenPrice";
import { TokenBalances, artifacts } from "../utils";
import { TokenBalance } from "../utils/TokenBalance";
import { MAX_BIPS, maxBN, toBN } from "../utils/helpers";

const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

const lazyMap = new WeakMap<object, Map<string, any>>();

export async function memoize<T>(parent: object, key: string, generate: () => Promise<T>): Promise<T> {
    let storage = lazyMap.get(parent);
    if (storage == undefined) {
        storage = new Map();
        lazyMap.set(parent, storage);
    }
    if (!storage.has(key)) {
        const value = await generate();
        storage.set(key, value);
    }
    return storage.get(key);
}

export class AgentInfoReader {
    constructor(
        public assetManager: IIAssetManagerInstance,
        public agentVault: string,
        public settings: AssetManagerSettings,
        public tokenPriceReader: TokenPriceReader,
        public info: AgentInfo,
        public vaultCollateral: CollateralPriceCalculator,
        public poolCollateral: CollateralPriceCalculator,
    ) {}

    static async create(assetManager: IIAssetManagerInstance, agentVault: string) {
        const settings = await assetManager.getSettings();
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const tokenPriceReader = await TokenPriceReader.create(settings);
        const vaultCollateralType = await assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        const poolCollateralType = await assetManager.getCollateralType(CollateralClass.POOL, await assetManager.getWNat());
        const vaultCollateral = await CollateralPriceCalculator.create(tokenPriceReader, settings, agentInfo, vaultCollateralType, agentVault);
        const poolCollateral = await CollateralPriceCalculator.create(tokenPriceReader, settings, agentInfo, poolCollateralType, agentInfo.collateralPool);
        return new AgentInfoReader(assetManager, agentVault, settings, tokenPriceReader, agentInfo, vaultCollateral, poolCollateral);
    }

    lotSizeUBA() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    async collateralPool() {
        return await memoize(this, "collateralPool", () => CollateralPool.at(this.info.collateralPool));
    }

    async collateralPoolToken() {
        return await memoize(this, "collateralPoolToken", async () => {
            const pool = await this.collateralPool();
            const tokenAddress = await pool.poolToken();
            return await CollateralPoolToken.at(tokenAddress);
        });
    }

    backedUBA() {
        return toBN(this.info.mintedUBA).add(toBN(this.info.reservedUBA)).add(toBN(this.info.redeemingUBA));
    }
}

export class CollateralPriceCalculator {
    constructor(
        public agentInfo: AgentInfo,
        public price: CollateralPrice,
        public balanceReader: TokenBalance,
        public collateralHolderAddress: string,
    ) {}

    currency = this.balanceReader;

    static async create(tokenPriceReader: TokenPriceReader, settings: AssetManagerSettings, agentInfo: AgentInfo, collateral: CollateralType, collateralHolderAddress: string) {
        const price = await CollateralPrice.forCollateral(tokenPriceReader, settings, collateral);
        const balanceReader = await TokenBalances.collateralType(collateral);
        return new CollateralPriceCalculator(agentInfo, price, balanceReader, collateralHolderAddress);
    }

    minCRBips() {
        return toBN(this.price.collateral.minCollateralRatioBIPS);
    }

    mintingCRBips() {
        return maxBN(toBN(this.price.collateral.minCollateralRatioBIPS), toBN(this.agentInfo.mintingVaultCollateralRatioBIPS));
    }

    mintingCollateralRequired(amountUBA: BN) {
        return this.price.convertUBAToTokenWei(amountUBA).mul(this.mintingCRBips()).addn(MAX_BIPS - 1).divn(MAX_BIPS);
    }

    async holderBalance() {
        return await memoize(this, "holderBalance", () => this.balanceReader.balance(this.collateralHolderAddress));
    }

    async freeCollateral(backedAmountUBA: BN) {
        const balance = await this.holderBalance();
        return balance.sub(this.mintingCollateralRequired(backedAmountUBA));
    }
}
