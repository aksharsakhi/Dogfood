import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { SessionPrincipal } from '@dogfood/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { RegistrationService } from './registration.service';
@ApiTags('Registrations')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('events/:eventId/registrations')
export class RegistrationController {
  constructor(
    @Inject(RegistrationService)
    private readonly registrations: RegistrationService,
  ) {}
  @Post() register(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.registrations.register(p, eventId);
  }
  @Get('me') mine(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.registrations.mine(p, eventId);
  }
  @Post('withdraw') withdraw(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.registrations.withdraw(p, eventId);
  }
}
