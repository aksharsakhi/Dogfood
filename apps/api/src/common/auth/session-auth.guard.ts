import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { AuthService } from '../../modules/identity/auth.service';
import { fail } from '../errors/domain-error';
export type PrincipalRequest = FastifyRequest & { principal: SessionPrincipal };
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    const principal = await this.auth.resolve(request);
    if (!principal) fail(401, 'UNAUTHENTICATED', 'Authentication is required.');
    request.principal = principal;
    return true;
  }
}
