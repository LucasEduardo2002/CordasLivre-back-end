import { Module } from '@nestjs/common';
import { StringsSyncService } from './strings-sync/strings-sync.service';
import { StringsController } from './strings.controller';
import { WebSearchService } from './web-search.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [StringsSyncService, WebSearchService],
  controllers: [StringsController],
})
export class StringsModule {}
