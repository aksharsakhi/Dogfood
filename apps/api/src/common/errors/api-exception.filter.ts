import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError } from '@dogfood/contracts';
import { Prisma } from '@prisma/client';
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const prismaCode =
      exception instanceof Prisma.PrismaClientKnownRequestError
        ? exception.code
        : null;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : prismaCode === 'P2025'
          ? 404
          : ['P2002', 'P2003', 'P2004'].includes(prismaCode ?? '')
            ? 409
            : 500;
    const response =
      exception instanceof HttpException ? exception.getResponse() : null;
    const messages =
      typeof response === 'object' && response !== null && 'message' in response
        ? response.message
        : null;
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'RESOURCE_NOT_FOUND',
      409: 'CONFLICT',
      503: 'SERVICE_UNAVAILABLE',
    };
    const explicitCode =
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string'
        ? response.code
        : null;
    const body: ApiError = {
      code:
        explicitCode ??
        (prismaCode === 'P2002'
          ? 'CONFLICT'
          : (codes[status] ??
            (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'))),
      message:
        status === 500
          ? 'An unexpected error occurred.'
          : status === 404
            ? 'The requested resource was not found.'
            : typeof messages === 'string'
              ? messages
              : 'The request could not be processed.',
      details: Array.isArray(messages) ? messages : null,
      requestId: request.id,
    };
    if (status >= 500) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.error(
          { requestId: request.id, code: body.code },
          exception instanceof Error ? exception.stack : String(exception),
        );
      } else {
        this.logger.error({ requestId: request.id, code: body.code });
      }
    }
    void reply.status(status).send(body);
  }
}
