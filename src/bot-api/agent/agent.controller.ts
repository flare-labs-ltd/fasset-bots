import { Controller, Get, Param } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from '../common/ApiResponse';
import { AgentCreateResponse } from '../common/AgentResponse';

@ApiTags("Agent")
@Controller("api/agent")
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get("create/:fAssetSymbol")
  public async create(@Param("fAssetSymbol") fAssetSymbol: string): Promise<ApiResponseWrapper<AgentCreateResponse | null>> {
    return handleApiResponse(this.agentService.createAgent(fAssetSymbol));
  }
}




