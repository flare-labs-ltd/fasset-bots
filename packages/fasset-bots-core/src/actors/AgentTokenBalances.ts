import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { TokenBalance, TokenBalances } from "../utils";
import { CurrencyFormatSettings } from "../utils/Currency";
import { BNish } from "../utils/helpers";


export class LazyTokenBalance {
    constructor(
        public initializer: () => Promise<TokenBalance>
    ) {}

    tokenBalance?: TokenBalance;

    async balance(address: string) {
        this.tokenBalance ??= await this.initializer();
        return await this.tokenBalance.balance(address);
    }

    async parse(amount: string) {
        this.tokenBalance ??= await this.initializer();
        return this.tokenBalance.currency.parse(amount);
    }

    async formatValue(amount: BNish, format?: CurrencyFormatSettings) {
        this.tokenBalance ??= await this.initializer();
        return this.tokenBalance.currency.formatValue(amount, format);
    }

    async format(amount: BNish, format?: CurrencyFormatSettings) {
        this.tokenBalance ??= await this.initializer();
        return this.tokenBalance.currency.format(amount, format);
    }
}

export class AgentTokenBalances {
    constructor(
        public context: IAssetAgentContext,
        public agentVaultAddress: string
    ) {}

    native = new LazyTokenBalance(() => TokenBalances.evmNative(this.context));
    underlying = new LazyTokenBalance(() => TokenBalances.fassetUnderlyingToken(this.context));
    fAsset = new LazyTokenBalance(() => TokenBalances.fasset(this.context));
    vaultCollateral = new LazyTokenBalance(() => TokenBalances.agentVaultCollateral(this.context, this.agentVaultAddress));
    poolCollateral = new LazyTokenBalance(() => TokenBalances.agentPoolCollateral(this.context, this.agentVaultAddress));
    poolToken = new LazyTokenBalance(() => TokenBalances.agentCollateralPoolToken(this.context, this.agentVaultAddress));
}
