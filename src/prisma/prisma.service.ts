import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);

    super({ adapter });
  }

  get dictionaryTerm() {
    return super.dictionaryTerm;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    // Clean up Prisma client here
    await this.$disconnect();
  }
}
