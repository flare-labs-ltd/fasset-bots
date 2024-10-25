import { Secrets } from '@flarelabs/fasset-bots-core/config';
import { requireEnv } from '@flarelabs/fasset-bots-core/utils';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");

@Injectable()
export class AuthService {
    constructor(private readonly jwtService: JwtService) {}

    public async login(password: string) {
        const secrets = Secrets.load(FASSET_BOT_SECRETS);
        const validPassword = secrets.required("apiKey.agent_bot");

        if (password !== validPassword) {
          throw new UnauthorizedException('Invalid password');
        }
        const payload = { user: 'admin' };
        const token = this.jwtService.sign(payload, { secret: validPassword });

        return token;
    }

}