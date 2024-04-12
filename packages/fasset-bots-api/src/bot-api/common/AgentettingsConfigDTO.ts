import { ApiProperty } from "@nestjs/swagger";

export class AgentSettingsConfigDTO {
    /**
     * Token suffix for the new collateral pool's token.
     * Must be unique within this fasset type.
     * @pattern ^[A-Z0-9]+(-[A-Z0-9]+)*$
     */
    @ApiProperty()
    poolTokenSuffix: string = "";

    /**
     * The tokenFtsoSymbol symbol in the collateral type for the created agent vault vault vollateral.
     * @pattern ^[\w\-]\w+$
     */
    @ApiProperty()
    vaultCollateralFtsoSymbol: string = "";

    /**
     * The minting fee percentage.
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    fee: string = "";

    /**
     * The percentage of the minting fee that goes to the collateral pool.
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    poolFeeShare: string = "";

    /**
     * Agent's minting collateral ratio for vault collateral (minimum CR at which the minting can happen).
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    mintingVaultCollateralRatio: string = "";

    /**
     * Agent's minting collateral ratio for pool collateral (minimum CR at which the minting can happen).
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    mintingPoolCollateralRatio: string = "";

    /**
     * Collateral pool's exit collateral ratio (minimum CR for pool collateral at which the collateral pool providers can exit;
     * however, self-close exit is allowed even at lower pool CR).
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    poolExitCollateralRatio: string = "";

    /**
     * FTSO price factor at which the agent pays for burned fassets (in vault tokens) during pool providers' self close exit.
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    buyFAssetByAgentFactor: string = "";

    /**
     * Pool collateral ratio below which the providers can enter at discounted rate.
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    poolTopupCollateralRatio: string = "";

    /**
     * Discounted price factor at which providers can enter when topup is active (i.e. the pool CR is below poolTopupCollateralRatio).
     * @pattern ^\d+(\.\d+)?%?$
     */
    @ApiProperty()
    poolTopupTokenPriceFactor: string = "";
}
