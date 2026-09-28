import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { SessionPrincipal } from '@dogfood/shared';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookDeliveryQueryDto,
} from './webhook.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('events/:eventId')
export class WebhooksController {
  constructor(
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  @Post('webhooks')
  create(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(principal, eventId, dto);
  }

  @Get('webhooks')
  list(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.webhooks.list(principal, eventId);
  }

  @Patch('webhooks/:subscriptionId')
  update(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(principal, eventId, subscriptionId, dto);
  }

  @Delete('webhooks/:subscriptionId')
  @HttpCode(204)
  async disable(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ) {
    await this.webhooks.disable(principal, eventId, subscriptionId);
  }

  @Post('webhooks/:subscriptionId/destination-secret')
  configureImportedSecret(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ) {
    return this.webhooks.configureImportedSecret(
      principal,
      eventId,
      subscriptionId,
    );
  }

  @Get('webhook-deliveries')
  history(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: WebhookDeliveryQueryDto,
  ) {
    return this.webhooks.history(principal, eventId, query.cursor);
  }

  @Post('webhook-deliveries/:deliveryId/replay')
  replay(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooks.replay(principal, eventId, deliveryId);
  }
}
