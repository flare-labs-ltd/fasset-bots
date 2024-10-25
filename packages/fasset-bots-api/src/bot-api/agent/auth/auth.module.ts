import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./auth-header-api-key.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthController } from "./auth.controller";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";

@Module({
    imports: [PassportModule],
    providers: [JwtStrategy, JwtAuthGuard, JwtService, AuthService],
    controllers:[AuthController],
    exports: [JwtAuthGuard]
})
export class AuthModule {}
