import { Module } from '@nestjs/common';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { IdentityModule } from './modules/identity/identity.module';
import { EventsModule } from './modules/events/events.module';
import { ParticipationModule } from './modules/participation/participation.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { HealthModule } from './modules/health/health.module';
import { TimeModule } from './common/time.module';
import { JudgingModule } from './modules/judging/judging.module';
@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    TimeModule,
    IdentityModule,
    EventsModule,
    ParticipationModule,
    ProjectsModule,
    HealthModule,
    JudgingModule,
  ],
})
export class AppModule {}
