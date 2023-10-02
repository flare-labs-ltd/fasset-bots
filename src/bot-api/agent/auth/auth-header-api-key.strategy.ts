import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import Strategy from 'passport-headerapikey';
import { createSha256Hash } from '../../../utils/helpers';

@Injectable()
export class HeaderApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
    constructor(
        private readonly configService: ConfigService
    ) {
        super({ header: 'X-API-KEY', prefix: '' },
        true,
        async (apiKey: any, done: any) => {
            return this.validate(apiKey, done);
        });
    }

    public validate = (apiKey: string, done: (error: Error | null, data: any) => object) => {
        const apiKeyHash = createSha256Hash(this.configService.get<string>('AGENT_BOT_API_KEY')!);
        if (apiKeyHash === apiKey) {
            done(null, true);
        }
        done(new UnauthorizedException(), null);
    }
}