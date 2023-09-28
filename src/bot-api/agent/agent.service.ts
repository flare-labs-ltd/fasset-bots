import { Injectable } from '@nestjs/common';
import { BotCliCommands } from '../../actors/AgentBotCliCommands';
import { AgentCreateResponse } from '../common/AgentResponse';

@Injectable()
export class AgentService {

  async createAgent(fAssetSymbol: string): Promise<AgentCreateResponse | null> {
    const cli = await BotCliCommands.create(fAssetSymbol);
    const agent = await cli.createAgentVault();
    if (agent) {
      return {
        vaultAddress: agent.vaultAddress,
        ownerAddress: agent.ownerAddress,
        collateralPoolAddress: agent.collateralPool.address,
        collateralPoolTokenAddress: agent.collateralPoolToken.address,
        underlyingAddress: agent.underlyingAddress
      }
    } return null;
  }
}
