import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PrincipalRequest } from './session-auth.guard';
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<PrincipalRequest>().principal,
);
