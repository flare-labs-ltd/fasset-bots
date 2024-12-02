export type LiquidatorBotStrategyDefinition = BotStrategy<DexLiquidationStrategyConfig | DefaultChallengeStrategyConfig>;
export type ChallengerBotStrategyDefinition = BotStrategy<DexChallengeStrategyConfig | DefaultChallengeStrategyConfig>;

export interface DefaultLiquidationStrategyConfig {
    gasPrice?: string;
}

export interface DefaultChallengeStrategyConfig {
    gasPrice?: string;
}

export interface DexLiquidationStrategyConfig extends DefaultLiquidationStrategyConfig {
    address: string;
    maxAllowedSlippage: number;
}

export interface DexChallengeStrategyConfig extends DefaultChallengeStrategyConfig {
    address: string;
    maxAllowedSlippage: number;
}

interface BotStrategy<T> {
    className: string;
    config?: T;
}
