import { Module } from '@nestjs/common';
import { StringsSyncService } from './strings-sync/strings-sync.service';
import { StringsController } from './strings.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  providers: [StringsSyncService, PrismaService],
  controllers: [StringsController]
})
export class StringsModule {}
