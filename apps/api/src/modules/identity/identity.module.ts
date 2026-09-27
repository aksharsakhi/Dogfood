import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessService } from '../../common/auth/access.service';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessService, SessionAuthGuard],
  exports: [AuthService, AccessService, SessionAuthGuard],
})
export class IdentityModule {}
