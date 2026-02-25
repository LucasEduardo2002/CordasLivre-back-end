import { Test, TestingModule } from '@nestjs/testing';
import { StringsSyncService } from './strings-sync.service';

describe('StringsSyncService', () => {
  let service: StringsSyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StringsSyncService],
    }).compile();

    service = module.get<StringsSyncService>(StringsSyncService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
