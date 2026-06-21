import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: "*" });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`cMahjong backend berjalan di http://localhost:${port}`, "Bootstrap");
}

bootstrap();
