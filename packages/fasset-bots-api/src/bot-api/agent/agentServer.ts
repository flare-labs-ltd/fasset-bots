import { NestFactory } from "@nestjs/core";
import { AgentModule } from "./agent.module";
import helmet from "helmet";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { WsAdapter } from "@nestjs/platform-ws";
import { initializeMikroORM } from "./mikro-orm.config";
import { Secrets } from "@flarelabs/fasset-bots-core/config";
import { requireEnv } from "@flarelabs/fasset-bots-core/utils";

export let cachedSecrets: Secrets;
const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");

export async function runAgentServer() {
    await initializeMikroORM();
    cachedSecrets = await Secrets.load(FASSET_BOT_SECRETS)
    const app = await NestFactory.create(AgentModule);
    app.useWebSocketAdapter(new WsAdapter(app));

    app.use(helmet());
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.enableCors();

    const config = new DocumentBuilder()
        .setTitle("FAsset agent bot REST APIs")
        .setDescription("FAsset agent bot REST APIs")
        .setVersion("1.0")
        .addBearerAuth()
        .build();
    const rootPath = process.env.ROOT_PATH || '';
    app.setGlobalPrefix(rootPath);
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api-doc", app, document);

    const port = 1234;
    await app.listen(port);
}
