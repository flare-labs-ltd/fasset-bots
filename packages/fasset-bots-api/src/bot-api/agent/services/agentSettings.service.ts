import { Injectable } from '@nestjs/common';
import { AgentSettingsConfigDTO } from '../../common/AgentSettingsConfigDTO';
import { AgentSettingsConfig } from '@flarelabs/fasset-bots-core/config';

@Injectable()
export class AgentSettingsService {
    mapDtoToInterface(dto: AgentSettingsConfigDTO): AgentSettingsConfig {
        const {
            poolTokenSuffix,
            vaultCollateralFtsoSymbol,
            fee,
            poolFeeShare,
            mintingVaultCollateralRatio,
            mintingPoolCollateralRatio,
            poolExitCollateralRatio,
            buyFAssetByAgentFactor,
            poolTopupCollateralRatio,
            poolTopupTokenPriceFactor,
            handshakeType
        } = dto;
        return {
            poolTokenSuffix,
            vaultCollateralFtsoSymbol,
            fee,
            poolFeeShare,
            mintingVaultCollateralRatio,
            mintingPoolCollateralRatio,
            poolExitCollateralRatio,
            buyFAssetByAgentFactor,
            poolTopupCollateralRatio,
            poolTopupTokenPriceFactor,
            handshakeType
        };
    }
}
