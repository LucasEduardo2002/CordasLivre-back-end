import { Controller, Get, Query } from '@nestjs/common';
import { StringsSyncService } from './strings-sync/strings-sync.service';

@Controller('strings')
export class StringsController 
{
    constructor(
      private readonly stringsSyncService: StringsSyncService,
    ) {}

    @Get("update")
    async update() {
        return await this.stringsSyncService.syncTopStrings();
    }

    @Get()
    async getAllStrings(@Query('type') type?: string) {
    return await this.stringsSyncService.getTopStrings(type);
  }
}
