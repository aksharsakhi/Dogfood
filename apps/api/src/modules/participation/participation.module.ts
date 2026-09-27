import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { TeamController, InvitationController } from './team.controller';
import { TeamService } from './team.service';
@Module({
  imports: [IdentityModule],
  controllers: [RegistrationController, TeamController, InvitationController],
  providers: [RegistrationService, TeamService],
})
export class ParticipationModule {}
