import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { MAX_ARCHIVE_BYTES } from './modules/event-archive/archive-format';

export async function configureApp(
  app: NestFastifyApplication,
  webOrigin: string,
): Promise<void> {
  await app.register(fastifyCookie);
  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      reply.header('x-request-id', request.id);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        ((request.headers.origin && request.headers.origin !== webOrigin) ||
          (!request.headers.origin &&
            request.headers['sec-fetch-site'] === 'cross-site'))
      ) {
        reply.status(403).send({
          code: 'CSRF_REJECTED',
          message: 'Request origin is not allowed.',
          details: null,
          requestId: request.id,
        });
      }
    });
  const config = new DocumentBuilder()
    .setTitle('Dogfood API')
    .setDescription('Hackathon platform API')
    .setVersion('0.2.0')
    .addCookieAuth('dogfood_session')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  app.enableShutdownHooks();
}
export async function createApp(webOrigin: string) {
  const fastifyInstance = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
  });
  fastifyInstance.addHook('onRoute', (routeOptions) => {
    if (
      typeof routeOptions.url === 'string' &&
      routeOptions.url.includes('/events/archives/')
    ) {
      routeOptions.bodyLimit = MAX_ARCHIVE_BYTES + 1024 * 1024;
    }
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(fastifyInstance),
  );
  await configureApp(app, webOrigin);
  return app;
}
