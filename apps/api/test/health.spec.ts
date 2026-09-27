import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DatabaseService } from '../src/infrastructure/database/database.service';
describe('API foundation', () => {
  let app: NestFastifyApplication;
  const query = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ $queryRaw: query })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app, 'http://localhost:3000');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    query.mockReset();
  });
  it('boots the full Nest module graph with all provider dependencies', () => {
    expect(app.getHttpAdapter().getInstance().ready).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });
  it('is alive independently of PostgreSQL', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'api' });
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
  });
  it('checks database connectivity for readiness', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    await request(app.getHttpServer())
      .get('/ready')
      .expect(200, { status: 'ready', database: 'connected' });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('returns safe, correlated errors when PostgreSQL fails', async () => {
    query.mockRejectedValue(new Error('secret connection details'));
    const response = await request(app.getHttpServer())
      .get('/ready')
      .expect(503);
    expect(response.body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: null,
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('standardizes missing resources', async () => {
    const response = await request(app.getHttpServer())
      .get('/missing')
      .expect(404);
    expect(response.body.code).toBe('RESOURCE_NOT_FOUND');
  });
  it('exposes the OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(response.body.paths).toHaveProperty('/health');
    expect(response.body.paths).toHaveProperty('/ready');
  });
});
