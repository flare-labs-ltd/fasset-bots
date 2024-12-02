import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { cachedSecrets } from "../agentServer";

@Injectable()
export class AuthService {
    constructor(private readonly jwtService: JwtService) {}

    public async login(password: string) {
        const validPassword = cachedSecrets.required("apiKey.agent_bot");

        if (password !== validPassword) {
          throw new UnauthorizedException('Invalid password');
        }
        const payload = { user: 'admin' };
        const token = this.jwtService.sign(payload, { secret: validPassword });

        return token;
    }

}