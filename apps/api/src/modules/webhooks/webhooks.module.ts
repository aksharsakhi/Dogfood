import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookTransport } from './webhook-transport';

@Module({
  imports: [IdentityModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookTransport],
  exports: [WebhooksService],
})
export class WebhooksModule {}
