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

  @Post('tone-assistant')
  async toneAssistant(
    @Body()
    body: {
      instrument?: string;
      level?: string;
      style?: string;
    },
  ) {
    return await this.stringsSyncService.recommendToneAssistant(body);
  }

  @Post('maintenance/register')
  async registerMaintenance(
    @Body()
    body: {
      userId?: string;
      email?: string;
      instrument?: string;
      lastChangeDate?: string;
      studyHoursPerWeek?: number;
    },
  ) {
    return await this.stringsSyncService.registerStringMaintenance(body);
  }

  @Get('maintenance/alerts')
  async getMaintenanceAlerts(
    @Query('email') email?: string,
    @Query('type') type?: string,
  ) {
    return await this.stringsSyncService.getMaintenanceAlerts(email, type);
  }

  @Get('health')
  async healthCheck() {
    return await this.stringsSyncService.checkDatabaseHealth();
  }
}
