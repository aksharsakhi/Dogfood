import { Module } from '@nestjs/common';
import {
  JudgingController,
  JudgeInvitationController,
} from './judging.controller';
import { OnboardingService } from './onboarding.service';
import { EvaluationsService } from './evaluations.service';
import { BatchService } from './batch.service';
import { ScoringService } from './scoring.service';
import { CsvExportService } from './csv-export.service';
import { PairwiseController } from '../pairwise/pairwise.controller';
import { PairwiseService } from '../pairwise/pairwise.service';
import { IdentityModule } from '../identity/identity.module';
@Module({
  imports: [IdentityModule],
  controllers: [
    JudgingController,
    JudgeInvitationController,
    PairwiseController,
  ],
  providers: [
    OnboardingService,
    EvaluationsService,
    BatchService,
    ScoringService,
    CsvExportService,
    PairwiseService,
  ],
  exports: [OnboardingService, ScoringService, CsvExportService],
})
export class JudgingModule {}
