import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { cachedSecrets } from "../agentServer";
import { ExtractJwt, Strategy } from "passport-jwt";


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        const apiKey = cachedSecrets.required("apiKey.agent_bot")
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
