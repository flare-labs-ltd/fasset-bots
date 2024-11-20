import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import Strategy from "passport-headerapikey";
import { cachedSecrets } from "../agentServer";

@Injectable()
export class HeaderApiKeyStrategy extends PassportStrategy(Strategy, "notifier_key") {
    constructor() {
        super({ header: "X-API-KEY", prefix: "" }, true, async (apiKey: any, done: any) => {
            return this.validate(apiKey, done);
        });
    }

    public validate = (apiKey: string, done: (error: Error | null, data: any) => object) => {
        const notifierKey = cachedSecrets.optional("apiKey.notifier_key");
        if (!notifierKey) {
            done(null, true);
        }
        if (notifierKey === apiKey) {
            done(null, true);
        }
        done(new UnauthorizedException(), null);
    };
}
