import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { requireEnv } from "@flarelabs/fasset-bots-core/utils";
import { Secrets } from "@flarelabs/fasset-bots-core/config";
import { ExtractJwt, Strategy } from "passport-jwt";

const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        const secrets = Secrets.load(FASSET_BOT_SECRETS);
        const apiKey = secrets.required("apiKey.agent_bot");
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: apiKey,
          });
    }

    async validate(payload: any){
        return {};
    }
}
