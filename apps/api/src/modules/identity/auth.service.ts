import { Inject, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AuditService } from '../audit/audit.service';
import { DomainError, fail } from '../../common/errors/domain-error';
import { Clock } from '../../common/time';
import { LoginDto, RegisterDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'dogfood_session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export const safeUser = (
  user: Pick<User, 'id' | 'email' | 'displayName' | 'status'>,
) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  status: user.status,
});
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    const displayName = dto.displayName.trim();
    if (!displayName)
      fail(400, 'VALIDATION_ERROR', 'Display name is required.');
    const passwordHash = await hashPassword(dto.password);
    try {
      const user = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email, displayName, passwordHash },
        });
        await this.audit.record(tx, {
          action: 'AUTH_REGISTER',
          entityType: 'User',
          entityId: created.id,
          actorUserId: created.id,
        });
        return created;
      });
      return safeUser(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new DomainError(
          409,
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists.',
        );
      throw error;
    }
  }

  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.db.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
    });
    const valid = await verifyPassword(
      dto.password,
      user?.passwordHash ?? null,
    );
    if (!valid || user?.status !== 'ACTIVE')
      fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      this.clock.now().getTime() + SESSION_SECONDS * 1000,
    );
    await this.db.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt,
          userAgent: userAgent?.slice(0, 512),
        },
      });
      await this.audit.record(tx, {
        action: 'AUTH_LOGIN_SUCCESS',
        entityType: 'Session',
        actorUserId: user.id,
        metadata: { expiresAt: expiresAt.toISOString() },
      });
    });
    return { user: safeUser(user), token };
  }

  async resolve(request: FastifyRequest): Promise<SessionPrincipal | null> {
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { platformRoles: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= this.clock.now() ||
      session.user.status !== 'ACTIVE'
    )
      return null;
    return {
      userId: session.userId,
      sessionId: session.id,
      platformRoles: session.user.platformRoles.map((r) => r.role),
    };
  }

  async logout(request: FastifyRequest): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.revokedAt) return;
    await this.db.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      if (result.count)
        await this.audit.record(tx, {
          action: 'AUTH_LOGOUT',
          entityType: 'Session',
          actorUserId: session.userId,
        });
    });
  }

  async me(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return safeUser(user);
  }
}
