import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AgentService } from "./services/agent.service";
import { AgentController } from "./controllers/agent.controller";
import { AgentVaultController } from "./controllers/vault.controller";
import { PoolController } from "./controllers/pool.controller";
import { UnderlyingController } from "./controllers/underlying.controller";
import { AuthModule } from "./auth/auth.module";
import { CacheModule } from "@nestjs/cache-manager";

@Module({
    imports: [ConfigModule.forRoot(), AuthModule, CacheModule.register()],
    controllers: [AgentController, AgentVaultController, PoolController, UnderlyingController],
    providers: [AgentService],
})
export class AgentModule {}
