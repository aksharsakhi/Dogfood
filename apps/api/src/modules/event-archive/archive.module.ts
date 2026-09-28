import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EventArchiveController } from './archive.controller';
import { EventArchiveService } from './archive.service';

@Module({
  imports: [IdentityModule],
  controllers: [EventArchiveController],
  providers: [EventArchiveService],
  exports: [EventArchiveService],
})
export class EventArchiveModule {}
