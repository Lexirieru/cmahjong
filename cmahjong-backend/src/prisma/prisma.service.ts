import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Wrapper PrismaClient untuk NestJS. Koneksi DB bersifat best-effort saat boot:
 * bila Postgres belum jalan, server tetap hidup (game state live tetap di memori),
 * dan operasi DB akan gagal eksplisit saat dipakai.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log("Terhubung ke Postgres");
    } catch (err) {
      this.logger.warn(`Postgres tidak tersedia saat boot: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
