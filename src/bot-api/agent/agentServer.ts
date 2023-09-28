import { NestFactory } from "@nestjs/core";
import { AgentModule } from "./agent.module";
import helmet from "helmet";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { WsAdapter } from "@nestjs/platform-ws";

export async function runAgentServer() {
    const app = await NestFactory.create(AgentModule);
    app.useWebSocketAdapter(new WsAdapter(app));

    app.use(helmet());
    app.useGlobalPipes(new ValidationPipe({ transform: true }));

    const config = new DocumentBuilder()
        .setTitle("FAsset agent bot api")
        .setDescription("FAsset agent bot api")
        .setVersion("1.0")
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api-doc", app, document);

    const port = 3306;
    await app.listen(port);
}