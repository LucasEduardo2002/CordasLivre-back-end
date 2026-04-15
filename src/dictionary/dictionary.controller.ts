import { Controller, Get, Param } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get()
  async findAll() {
    return this.dictionaryService.findAll();
  }

  @Get(':term')
  async findOne(@Param('term') term: string) {
    return this.dictionaryService.findByTerm(term);
  }
}