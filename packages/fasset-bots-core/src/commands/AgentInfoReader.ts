import BN from "bn.js";
import { IIAssetManagerInstance } from "../../typechain-truffle";
import { AgentInfo, AssetManagerSettings, CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { CollateralPrice } from "../state/CollateralPrice";
import { TokenPriceReader } from "../state/TokenPrice";
import { latestBlockTimestampBN, TokenBalances } from "../utils";
import { TokenBalance } from "../utils/TokenBalance";
import { MAX_BIPS, maxBN, toBN } from "../utils/helpers";

export class AgentInfoReader {
    constructor(
        public assetManager: IIAssetManagerInstance,
        public agentVault: string,
        public settings: AssetManagerSettings,
        public tokenPriceReader: TokenPriceReader,
        public info: AgentInfo,
        public vaultCollateral: CollateralPriceCalculator,
        public poolCollateral: CollateralPriceCalculator,
        public poolTokenBalanceReader: TokenBalance,
        public timestamp: BN,
    ) {}

    static async create(assetManager: IIAssetManagerInstance, agentVault: string) {
        const settings = await assetManager.getSettings();
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const tokenPriceReader = await TokenPriceReader.create(settings);
        const vaultCollateralType = await assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        const poolCollateralType = await assetManager.getCollateralType(CollateralClass.POOL, await assetManager.getWNat());
        const vaultCollateral = await CollateralPriceCalculator.create(tokenPriceReader, settings, agentInfo, vaultCollateralType, agentVault);
        const poolCollateral = await CollateralPriceCalculator.create(tokenPriceReader, settings, agentInfo, poolCollateralType, agentInfo.collateralPool);
        const poolTokenBalance = await TokenBalances.collateralPoolToken(agentInfo.collateralPool);
        const timestamp = await latestBlockTimestampBN();
        return new AgentInfoReader(assetManager, agentVault, settings, tokenPriceReader, agentInfo, vaultCollateral, poolCollateral, poolTokenBalance, timestamp);
    }

    lotSizeUBA() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
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

    collateralClass() {
        return Number(this.price.collateral.collateralClass) as CollateralClass;
    }

    minCRBips() {
        return toBN(this.price.collateral.minCollateralRatioBIPS);
    }

    mintingCRBips() {
        const mintingCR = this.collateralClass() === CollateralClass.VAULT ?
            this.agentInfo.mintingVaultCollateralRatioBIPS : this.agentInfo.mintingPoolCollateralRatioBIPS;
        return maxBN(toBN(this.price.collateral.minCollateralRatioBIPS), toBN(mintingCR));
    }

    mintingCollateralRequired(amountUBA: BN) {
        return this.price.convertUBAToTokenWei(amountUBA).mul(this.mintingCRBips()).addn(MAX_BIPS - 1).divn(MAX_BIPS);
    }

    async holderBalance() {
        return await this.balanceReader.balance(this.collateralHolderAddress);
    }
}
