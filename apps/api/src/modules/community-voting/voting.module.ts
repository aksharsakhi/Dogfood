import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CommunityVotingController } from './voting.controller';
import { CommunityVotingService } from './voting.service';

@Module({
  imports: [IdentityModule],
  controllers: [CommunityVotingController],
  providers: [CommunityVotingService],
})
export class CommunityVotingModule {}
