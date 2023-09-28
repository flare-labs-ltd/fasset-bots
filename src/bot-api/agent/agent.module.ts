import { Module } from "@nestjs/common";
import { AgentService } from "./services/agent.service";
import { AgentController } from "./controllers/agent.controller";
import { AgentVaultController } from "./controllers/vault.controller";
import { PoolController } from "./controllers/pool.controller";
import { UnderlyingController } from "./controllers/underlying.controller";

@Module({
    imports: [],
    controllers: [AgentController, AgentVaultController, PoolController, UnderlyingController],
    providers: [AgentService],
})
export class AgentModule {}
