import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StringsSyncService } from './strings-sync/strings-sync.service';
import { WebSearchService } from './web-search.service';
@Controller('strings')
export class StringsController {
  constructor(
    private readonly stringsSyncService: StringsSyncService,
    private readonly webSearchService: WebSearchService,
  ) { }

  @Get("update")
  async update() {
    return await this.stringsSyncService.syncTopStrings();
  }

  @Get()
  async getAllStrings(@Query('type') type?: string) {
    return await this.stringsSyncService.getTopStrings(type);
  }

  @Post('ai-review')
  async generateAiReview(
    @Body()
    body: {
      title?: string;
      price?: number;
      ratingAvg?: number | null;
      ratingCount?: number;
      type?: string;
      permalink?: string;
    },
  ) {
    return await this.stringsSyncService.generateAiReview(body);
  }

  @Get('web-search')
  async searchWeb(
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.webSearchService.searchWeb({
      q,
      type,
      limit: Number(limit ?? 20),
    });
  }
  @Get('health')
  async healthCheck() {
    return await this.stringsSyncService.checkDatabaseHealth();
  }
}
