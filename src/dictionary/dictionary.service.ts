import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DictionaryService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.dictionaryTerm.findMany({
      orderBy: { term: 'asc' },
    });
  }

  async findByTerm(term: string) {
    return this.prisma.dictionaryTerm.findFirst({
      where: { term },
    });
  }
}