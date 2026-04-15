import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { StringsModule } from './strings/strings.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DictionaryModule } from './dictionary/dictionary.module';

@Module({
  imports: [StringsModule, ScheduleModule.forRoot(), DictionaryModule],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
