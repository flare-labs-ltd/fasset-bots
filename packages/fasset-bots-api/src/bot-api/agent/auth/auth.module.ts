import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./auth-header-api-key.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthController } from "./auth.controller";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { HeaderApiKeyStrategy } from "./apiAuth.service";

@Module({
    imports: [PassportModule],
    providers: [JwtStrategy, JwtAuthGuard, JwtService, AuthService, HeaderApiKeyStrategy],
    controllers:[AuthController],
    exports: [JwtAuthGuard]
})
export class AuthModule {}
