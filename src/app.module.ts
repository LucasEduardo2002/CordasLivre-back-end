import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StringsModule } from './strings/strings.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DictionaryModule } from './dictionary/dictionary.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [StringsModule, ScheduleModule.forRoot(), DictionaryModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
