import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  eventId?: string;
  actorUserId?: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    await tx.auditEvent.create({ data: input });
  }
}
