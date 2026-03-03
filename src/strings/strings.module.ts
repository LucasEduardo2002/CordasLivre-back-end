import { Module } from '@nestjs/common';
import { StringsSyncService } from './strings-sync/strings-sync.service';
import { StringsController } from './strings.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { WebSearchService } from './web-search.service';

@Module({
  providers: [StringsSyncService, PrismaService, WebSearchService],
  controllers: [StringsController]
})
export class StringsModule {}
