import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { fail } from '../../common/errors/domain-error';
import type { SessionPrincipal } from '@dogfood/shared';
import { AuditService } from '../audit/audit.service';
import { CreateWebhookDto, UpdateWebhookDto } from './webhook.dto';
import { resolvePublicAddress } from './webhook-security';
import { WebhookTransport } from './webhook-transport';

const retryLimit = 8;
const pageSize = 50;
type SecretParts = {
  secretCiphertext: string;
  secretIv: string;
  secretAuthTag: string;
};

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WebhookTransport) private readonly transport: WebhookTransport,
  ) {
    this.encryptionKey();
  }

  onModuleInit() {
    if (process.env.WEBHOOK_WORKER_DISABLED === 'true') return;
    this.timer = setInterval(() => {
      void this.processOne().catch(() => {
        this.logger.warn(
          'Webhook delivery worker encountered a recoverable error.',
        );
      });
    }, 2_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private encryptionKey(): Buffer {
    const configured = process.env.WEBHOOK_ENCRYPTION_KEY?.trim();
    if (!configured || configured.length < 32)
      throw new Error(
        'WEBHOOK_ENCRYPTION_KEY is required at API startup and must contain at least 32 characters.',
      );
    return createHmac('sha256', 'dogfood-webhook-secret-encryption-v1')
      .update(configured)
      .digest();
  }

  private encrypt(secret: string): SecretParts {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return {
      secretCiphertext: ciphertext.toString('base64url'),
      secretIv: iv.toString('hex'),
      secretAuthTag: cipher.getAuthTag().toString('hex'),
    };
  }

  private decrypt(subscription: SecretParts): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(subscription.secretIv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(subscription.secretAuthTag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(subscription.secretCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private async authorize(principal: SessionPrincipal, eventId: string) {
    await this.access.organizer(principal, eventId);
  }

  private async assertSafeDestination(url: string) {
    try {
      await resolvePublicAddress(url);
    } catch {
      fail(
        400,
        'UNSAFE_WEBHOOK_DESTINATION',
        'Webhook URL must use HTTPS and resolve only to public addresses.',
      );
    }
  }

  async create(
    principal: SessionPrincipal,
    eventId: string,
    dto: CreateWebhookDto,
  ) {
    await this.authorize(principal, eventId);
    await this.assertSafeDestination(dto.url);
    const secret = randomBytes(32).toString('base64url');
    const subscription = await this.db.$transaction(async (tx) => {
      const created = await tx.webhookSubscription.create({
        data: {
          eventId,
          createdById: principal.userId,
          url: dto.url,
          eventTypes: [...new Set(dto.eventTypes)],
          ...this.encrypt(secret),
        },
        select: {
          id: true,
          eventId: true,
          url: true,
          eventTypes: true,
          active: true,
          createdAt: true,
        },
      });
      await this.audit.record(tx, {
        action: 'WEBHOOK_SUBSCRIPTION_CREATED',
        entityType: 'WebhookSubscription',
        entityId: created.id,
        eventId,
        actorUserId: principal.userId,
      });
      return created;
    });
    return { ...subscription, signingSecret: secret };
  }

  async list(principal: SessionPrincipal, eventId: string) {
    await this.authorize(principal, eventId);
    return this.db.webhookSubscription.findMany({
      where: { eventId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        eventId: true,
        url: true,
        eventTypes: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { deliveries: true } },
        deliveries: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            attempts: true,
            lastAttemptAt: true,
            lastHttpStatus: true,
            lastError: true,
            deliveredAt: true,
          },
        },
      },
    });
  }

  async update(
    principal: SessionPrincipal,
    eventId: string,
    subscriptionId: string,
    dto: UpdateWebhookDto,
  ) {
    await this.authorize(principal, eventId);
    if (dto.url !== undefined) await this.assertSafeDestination(dto.url);
    return this.db.$transaction(async (tx) => {
      const existing = await tx.webhookSubscription.findFirst({
        where: { id: subscriptionId, eventId },
        select: { id: true },
      });
      if (!existing)
        fail(404, 'WEBHOOK_NOT_FOUND', 'Webhook subscription was not found.');
      const updated = await tx.webhookSubscription.update({
        where: { id: subscriptionId },
        data: {
          ...(dto.url !== undefined ? { url: dto.url } : {}),
          ...(dto.eventTypes !== undefined
            ? { eventTypes: [...new Set(dto.eventTypes)] }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        select: {
          id: true,
          eventId: true,
          url: true,
          eventTypes: true,
          active: true,
          updatedAt: true,
        },
      });
      await this.audit.record(tx, {
        action: 'WEBHOOK_SUBSCRIPTION_UPDATED',
        entityType: 'WebhookSubscription',
        entityId: subscriptionId,
        eventId,
        actorUserId: principal.userId,
        metadata: { fields: Object.keys(dto) },
      });
      return updated;
    });
  }

  async disable(
    principal: SessionPrincipal,
    eventId: string,
    subscriptionId: string,
  ) {
    return this.update(principal, eventId, subscriptionId, { active: false });
  }

  async history(principal: SessionPrincipal, eventId: string, cursor?: string) {
    await this.authorize(principal, eventId);
    if (
      cursor &&
      !(await this.db.webhookDelivery.findFirst({
        where: { id: cursor, subscription: { eventId } },
        select: { id: true },
      }))
    )
      fail(400, 'INVALID_CURSOR', 'Delivery cursor is invalid.');
    const rows = await this.db.webhookDelivery.findMany({
      where: { subscription: { eventId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        attempts: true,
        manualReplays: true,
        lastAttemptAt: true,
        lastHttpStatus: true,
        lastError: true,
        deliveredAt: true,
        createdAt: true,
        subscription: { select: { id: true } },
        outboxEvent: {
          select: { eventType: true, occurredAt: true, payload: true },
        },
        history: {
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: { startedAt: true, httpStatus: true, error: true },
        },
      },
    });
    const items = rows.slice(0, pageSize);
    return {
      items,
      nextCursor: rows.length > pageSize ? items.at(-1)!.id : null,
    };
  }

  async replay(
    principal: SessionPrincipal,
    eventId: string,
    deliveryId: string,
  ) {
    await this.authorize(principal, eventId);
    return this.db.$transaction(async (tx) => {
      const delivery = await tx.webhookDelivery.findFirst({
        where: { id: deliveryId, subscription: { eventId } },
        select: { id: true, status: true },
      });
      if (!delivery)
        fail(
          404,
          'WEBHOOK_DELIVERY_NOT_FOUND',
          'Webhook delivery was not found.',
        );
      const replayed = await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'PENDING',
          cycleAttempts: 0,
          manualReplays: { increment: 1 },
          nextAttemptAt: new Date(),
          leaseUntil: null,
          leaseToken: null,
        },
        select: {
          id: true,
          status: true,
          attempts: true,
          manualReplays: true,
          nextAttemptAt: true,
        },
      });
      await this.audit.record(tx, {
        action: 'WEBHOOK_DELIVERY_REPLAYED',
        entityType: 'WebhookDelivery',
        entityId: delivery.id,
        eventId,
        actorUserId: principal.userId,
      });
      return replayed;
    });
  }

  private async claim(): Promise<{ id: string; leaseToken: string } | null> {
    return this.db.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<
        Array<{ id: string; leaseToken: string }>
      >`
        WITH candidate AS (
          SELECT d.id
          FROM "WebhookDelivery" d
          JOIN "WebhookSubscription" s ON s.id = d."subscriptionId"
          WHERE s.active = true AND (
            (d.status IN ('PENDING', 'RETRYING') AND d."nextAttemptAt" <= NOW()) OR
            (d.status = 'DELIVERING' AND d."leaseUntil" <= NOW())
          )
          ORDER BY d."nextAttemptAt", d.id
          FOR UPDATE OF d SKIP LOCKED
          LIMIT 1
        )
        UPDATE "WebhookDelivery" d
        SET status = 'DELIVERING', "leaseUntil" = NOW() + INTERVAL '30 seconds',
            "leaseToken" = gen_random_uuid(), attempts = attempts + 1,
            "cycleAttempts" = "cycleAttempts" + 1, "lastAttemptAt" = NOW(), "updatedAt" = NOW()
        FROM candidate c WHERE d.id = c.id
        RETURNING d.id, d."leaseToken" AS "leaseToken"`;
      const claimed = candidates[0];
      if (!claimed) return null;
      const attempt = await tx.webhookDelivery.findUniqueOrThrow({
        where: { id: claimed.id },
        select: { attempts: true },
      });
      await tx.webhookDeliveryAttempt.create({
        data: { deliveryId: claimed.id, attemptNo: attempt.attempts },
      });
      return claimed;
    });
  }

  async processOne(): Promise<boolean> {
    const claimed = await this.claim();
    if (!claimed) return false;
    const delivery = await this.db.webhookDelivery.findUnique({
      where: { id: claimed.id },
      include: { subscription: true, outboxEvent: true },
    });
    if (!delivery) return true;
    let status: number | null = null;
    let error: string | null = null;
    try {
      const envelope = {
        ...(delivery.outboxEvent.payload as Record<string, unknown>),
        deliveryId: delivery.id,
      };
      status = await this.transport.send(
        delivery.subscription.url,
        this.decrypt(delivery.subscription),
        delivery.id,
        delivery.outboxEvent.eventType,
        JSON.stringify(envelope),
      );
      if (status < 200 || status >= 300)
        error =
          status >= 300 && status < 400
            ? 'redirect_rejected'
            : 'http_delivery_failed';
    } catch (caught) {
      error =
        caught instanceof Error && caught.message.includes('public addresses')
          ? 'destination_resolution_rejected'
          : caught instanceof Error && caught.message.includes('prohibited')
            ? 'destination_rejected'
            : caught instanceof Error && caught.message.includes('HTTPS')
              ? 'destination_rejected'
              : 'network_error';
    }
    const succeeded = error === null;
    const exhausted = !succeeded && delivery.cycleAttempts >= retryLimit;
    const delayMs = Math.min(
      3_600_000,
      5_000 * 2 ** Math.max(0, delivery.cycleAttempts - 1),
    );
    const jittered = Math.round(delayMs * (0.8 + Math.random() * 0.4));
    const finishedAt = new Date();
    await this.db.$transaction(async (tx) => {
      const attempt = await tx.webhookDeliveryAttempt.updateMany({
        where: { deliveryId: delivery.id, attemptNo: delivery.attempts },
        data: { httpStatus: status, error, completedAt: finishedAt },
      });
      if (!attempt.count) return;
      await tx.webhookDelivery.updateMany({
        where: { id: delivery.id, leaseToken: claimed.leaseToken },
        data: {
          status: succeeded
            ? 'DELIVERED'
            : exhausted
              ? 'EXHAUSTED'
              : 'RETRYING',
          leaseUntil: null,
          leaseToken: null,
          lastHttpStatus: status,
          lastError: error,
          ...(succeeded ? { deliveredAt: finishedAt } : {}),
          ...(!succeeded && !exhausted
            ? { nextAttemptAt: new Date(finishedAt.getTime() + jittered) }
            : {}),
        },
      });
    });
    return true;
  }
}
