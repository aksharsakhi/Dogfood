import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  EventRecordsController,
  PublicJudgeRecordsController,
} from './judge-records.controller';
import { JudgeRecordsService } from './judge-records.service';

@Module({
  imports: [IdentityModule],
  controllers: [PublicJudgeRecordsController, EventRecordsController],
  providers: [JudgeRecordsService],
  exports: [JudgeRecordsService],
})
export class JudgeRecordsModule {}
