import { Test, TestingModule } from '@nestjs/testing';
import { StringsController } from './strings.controller';

describe('StringsController', () => {
  let controller: StringsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StringsController],
    }).compile();

    controller = module.get<StringsController>(StringsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
