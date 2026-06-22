import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient wrapper for NestJS. The DB connection is best-effort at boot:
 * if Postgres is not running yet, the server stays up (live game state remains in memory),
 * and DB operations will fail explicitly when used.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log("Connected to Postgres");
    } catch (err) {
      this.logger.warn(`Postgres not available at boot: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
