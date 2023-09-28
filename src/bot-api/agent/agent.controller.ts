import { Controller, Get } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ApiTags } from "@nestjs/swagger";

@ApiTags("Agent")
@Controller("api/agent")
export class AgentController {
  constructor(private readonly appService: AgentService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}



