import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import Strategy from "passport-headerapikey";
import { requireEnv } from "@flarelabs/fasset-bots-core/utils";
import { Secrets } from "@flarelabs/fasset-bots-core/config";

const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");

@Injectable()
export class HeaderApiKeyStrategy extends PassportStrategy(Strategy, "api-key") {
    constructor(private readonly configService: ConfigService) {
        super({ header: "X-API-KEY", prefix: "" }, true, async (apiKey: any, done: any) => {
            return this.validate(apiKey, done);
        });
    }

    public validate = (apiKey: string, done: (error: Error | null, data: any) => object) => {
        const secrets = Secrets.load(FASSET_BOT_SECRETS);
        const apiKeyHash = secrets.required("apiKey.agent_bot");
        if (apiKeyHash === apiKey) {
            done(null, true);
        }
        done(new UnauthorizedException(), null);
    };
}
