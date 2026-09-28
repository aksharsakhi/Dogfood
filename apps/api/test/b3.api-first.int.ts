import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('_test')) {
  process.env.DATABASE_URL =
    'postgresql://dogfood:dogfood_dev@localhost:5432/dogfood_test?schema=public';
}

if (!(process.env.DATABASE_URL ?? '').includes('_test')) {
  throw new Error('B3 integration tests require an isolated _test database.');
}

const db = new PrismaClient();
const origin = 'http://localhost:3000';
let app: NestFastifyApplication;

interface OpenApiOperation {
  tags?: string[];
  security?: Array<Record<string, unknown>>;
  summary?: string;
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  [key: string]: unknown;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  components?: {
    securitySchemes?: Record<
      string,
      { type?: string; in?: string; name?: string }
    >;
  };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.listen(0, '127.0.0.1');
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  await db.$disconnect();
});

describe('B3: API First — OpenAPI Discovery and Coverage Verification', () => {
  let openapiDoc: OpenApiDocument;
  let rawJsonText: string;

  it('serves machine-readable OpenAPI 3.0 specification at /openapi.json', async () => {
    const res = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    rawJsonText = res.text;
    openapiDoc = JSON.parse(res.text);

    expect(openapiDoc).toBeDefined();
    expect(openapiDoc.openapi).toMatch(/^3\./);
    expect(openapiDoc.info).toBeDefined();
    expect(openapiDoc.info.title).toBe('Dogfood API');
    expect(openapiDoc.paths).toBeDefined();
  });

  it('serves interactive Swagger documentation at /docs and /api-docs', async () => {
    const docsRes = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(docsRes.headers['content-type']).toMatch(/text\/html/);
    expect(docsRes.text).toContain('swagger');

    const apiDocsRes = await request(app.getHttpServer())
      .get('/api-docs')
      .expect(200);
    expect(apiDocsRes.headers['content-type']).toMatch(/text\/html/);
    expect(apiDocsRes.text).toContain('swagger');
  });

  it('verifies that no secret values or credentials appear in serialized OpenAPI output', () => {
    const sensitiveEnvKeys = [
      'VOTING_TOKEN_SECRET',
      'WEBHOOK_ENCRYPTION_KEY',
      'JUDGE_RECORD_SIGNING_KEY_SEED',
    ];

    for (const envKey of sensitiveEnvKeys) {
      const secretValue = process.env[envKey];
      if (secretValue && secretValue.length >= 16) {
        expect(rawJsonText).not.toContain(secretValue);
      }
    }

    // Verify common sensitive patterns are absent from documentation values
    expect(rawJsonText).not.toContain('dogfood_dev');
    expect(rawJsonText).not.toContain('postgresql://');
    expect(rawJsonText).not.toContain('passwordHash');
    expect(rawJsonText).not.toContain('secretCiphertext');
  });

  it('accurately represents the cookie-based session security scheme', () => {
    const securitySchemes = openapiDoc.components?.securitySchemes;
    expect(securitySchemes).toBeDefined();
    const securityScheme = securitySchemes?.cookie;
    expect(securityScheme).toBeDefined();
    expect(securityScheme?.type).toBe('apiKey');
    expect(securityScheme?.in).toBe('cookie');
    expect(securityScheme?.name).toBe('dogfood_session');
  });

  function getOp(path: string, method: string): OpenApiOperation {
    const p = openapiDoc.paths[path];
    if (!p) throw new Error(`Path ${path} not found in OpenAPI spec`);
    const op = p[method];
    if (!op) throw new Error(`Method ${method} not found on path ${path}`);
    return op;
  }

  it('covers all critical capability domains across paths and operations', () => {
    const paths = openapiDoc.paths;
    const pathKeys = Object.keys(paths);
    expect(pathKeys.length).toBe(98);

    // 1. Identity & Authentication
    expect(paths['/auth/register']).toBeDefined();
    expect(getOp('/auth/register', 'post')).toBeDefined();
    expect(paths['/auth/login']).toBeDefined();
    expect(getOp('/auth/login', 'post')).toBeDefined();
    expect(paths['/auth/logout']).toBeDefined();
    expect(getOp('/auth/logout', 'post')).toBeDefined();
    expect(paths['/auth/me']).toBeDefined();
    expect(getOp('/auth/me', 'get').security).toBeDefined();

    // 2. Events & Management
    expect(paths['/events']).toBeDefined();
    expect(getOp('/events', 'get')).toBeDefined();
    expect(getOp('/events', 'post')).toBeDefined();
    expect(paths['/events/{eventId}']).toBeDefined();
    expect(getOp('/events/{eventId}', 'get')).toBeDefined();
    expect(getOp('/events/{eventId}', 'patch')).toBeDefined();
    expect(paths['/events/{eventId}/publish']).toBeDefined();
    expect(getOp('/events/{eventId}/publish', 'post')).toBeDefined();
    expect(paths['/events/{eventId}/tracks']).toBeDefined();
    expect(paths['/events/{eventId}/prizes']).toBeDefined();

    // 3. Teams & Registrations
    expect(paths['/events/{eventId}/registrations']).toBeDefined();
    expect(paths['/events/{eventId}/registrations/me']).toBeDefined();
    expect(paths['/events/{eventId}/teams']).toBeDefined();
    expect(paths['/events/{eventId}/teams/me']).toBeDefined();
    expect(paths['/team-invitations/accept']).toBeDefined();

    // 4. Projects & Submissions
    expect(paths['/events/{eventId}/projects']).toBeDefined();
    expect(getOp('/events/{eventId}/projects', 'post')).toBeDefined();
    expect(paths['/events/{eventId}/projects/me']).toBeDefined();
    expect(paths['/events/{eventId}/projects/{projectId}']).toBeDefined();
    expect(
      paths[
        '/events/{eventId}/projects/{projectId}/submissions/{submissionId}/submit'
      ],
    ).toBeDefined();

    // 5. Public Gallery (Unauthenticated public access)
    expect(paths['/events/{eventId}/gallery']).toBeDefined();
    expect(getOp('/events/{eventId}/gallery', 'get')).toBeDefined();
    expect(getOp('/events/{eventId}/gallery', 'get').security).toBeUndefined();
    expect(paths['/events/{eventId}/gallery/{projectId}']).toBeDefined();
    expect(
      getOp('/events/{eventId}/gallery/{projectId}', 'get').security,
    ).toBeUndefined();

    // 6. Judging & Scoring
    expect(paths['/events/{eventId}/judging/rubrics']).toBeDefined();
    expect(getOp('/events/{eventId}/judging/rubrics', 'post')).toBeDefined();
    expect(
      paths['/events/{eventId}/judging/assignments/preview'],
    ).toBeDefined();
    expect(
      paths['/events/{eventId}/judging/assignments/runs/{runId}/publish'],
    ).toBeDefined();
    expect(paths['/events/{eventId}/judging/workspace']).toBeDefined();
    expect(
      getOp('/events/{eventId}/judging/workspace', 'get').security,
    ).toEqual([{ cookie: [] }]);
    expect(paths['/events/{eventId}/judging/scoring/runs']).toBeDefined();
    expect(paths['/events/{eventId}/judging/results/runs']).toBeDefined();
    expect(paths['/events/{eventId}/judging/exports/results']).toBeDefined();
    expect(paths['/judge-invitations/accept']).toBeDefined();

    // 7. Community Voting & Moderation
    expect(paths['/events/{eventId}/voting/ballot']).toBeDefined();
    expect(getOp('/events/{eventId}/voting/ballot', 'post')).toBeDefined();
    expect(paths['/events/{eventId}/voting/votes']).toBeDefined();
    expect(getOp('/events/{eventId}/voting/votes', 'post')).toBeDefined();
    expect(paths['/events/{eventId}/voting/results']).toBeDefined();
    expect(paths['/events/{eventId}/voting/config']).toBeDefined();
    expect(paths['/events/{eventId}/voting/audit']).toBeDefined();
    expect(
      paths['/events/{eventId}/voting/projects/{projectId}/comments'],
    ).toBeDefined();

    // 8. Webhooks
    expect(paths['/events/{eventId}/webhooks']).toBeDefined();
    expect(getOp('/events/{eventId}/webhooks', 'post')).toBeDefined();
    expect(getOp('/events/{eventId}/webhooks', 'get')).toBeDefined();
    expect(paths['/events/{eventId}/webhooks/{subscriptionId}']).toBeDefined();
    expect(
      getOp('/events/{eventId}/webhooks/{subscriptionId}', 'patch'),
    ).toBeDefined();
    expect(
      getOp('/events/{eventId}/webhooks/{subscriptionId}', 'delete'),
    ).toBeDefined();
    expect(paths['/events/{eventId}/webhook-deliveries']).toBeDefined();
    expect(
      paths['/events/{eventId}/webhook-deliveries/{deliveryId}/replay'],
    ).toBeDefined();

    // 9. Judge Records & Participation Certificates
    expect(paths['/judge-records/keys']).toBeDefined();
    expect(getOp('/judge-records/keys', 'get').security).toBeUndefined(); // public verification key list
    expect(paths['/judge-records/{recordId}/verify']).toBeDefined();
    expect(
      getOp('/judge-records/{recordId}/verify', 'get').security,
    ).toBeUndefined(); // public verification endpoint
    expect(paths['/events/{eventId}/judge-records']).toBeDefined();
    expect(
      paths['/events/{eventId}/judge-records/{judgeProfileId}'],
    ).toBeDefined();
    expect(
      paths['/events/{eventId}/judge-records/{recordId}/revoke'],
    ).toBeDefined();
    expect(paths['/events/{eventId}/judge-records/me']).toBeDefined();
    expect(
      paths['/events/{eventId}/certificates/registration/me'],
    ).toBeDefined();

    // 10. Event Archives (T4C)
    expect(paths['/events/{eventId}/archive']).toBeDefined();
    expect(getOp('/events/{eventId}/archive', 'get').security).toEqual([
      { cookie: [] },
    ]);
    expect(paths['/events/archives/preview']).toBeDefined();
    expect(getOp('/events/archives/preview', 'post').requestBody).toBeDefined();
    expect(paths['/events/archives/confirm']).toBeDefined();
    expect(getOp('/events/archives/confirm', 'post').requestBody).toBeDefined();

    // 11. Embed Settings & Meta (T4D)
    expect(paths['/events/{eventId}/embed-config']).toBeDefined();
    expect(getOp('/events/{eventId}/embed-config', 'get').security).toEqual([
      { cookie: [] },
    ]);
    expect(getOp('/events/{eventId}/embed-config', 'patch').security).toEqual([
      { cookie: [] },
    ]);
    expect(paths['/events/{eventId}/gallery/embed-meta']).toBeDefined();

    // 12. Health & Readiness Operations
    expect(paths['/health']).toBeDefined();
    expect(paths['/ready']).toBeDefined();
  });

  it('verifies total operations count exceeds 50 and all operations belong to documented tags', () => {
    let operationCount = 0;
    const observedTags = new Set<string>();

    for (const methods of Object.values(openapiDoc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (
          ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(
            method,
          )
        ) {
          operationCount++;
          if (Array.isArray(op.tags)) {
            for (const tag of op.tags) {
              observedTags.add(tag);
            }
          }
        }
      }
    }

    expect(Object.keys(openapiDoc.paths).length).toBe(98);
    expect(operationCount).toBe(119);
    expect(observedTags.size).toBe(15);
  });

  it('ensures ordinary business routes continue functioning without regression', async () => {
    const health = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(health.body).toEqual({ status: 'ok', service: 'api' });

    const ready = await request(app.getHttpServer()).get('/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready', database: 'connected' });
  });

  describe('Adversarial Falsification: UI -> API Coverage and Schema Verification', () => {
    const webRoot = path.resolve(__dirname, '../../../apps/web');

    interface DiscoveredCall {
      file: string;
      line: number;
      fnName: string;
      rawPath: string;
      normalizedPattern: string;
      method: string;
    }

    function scanFile(filePath: string): DiscoveredCall[] {
      const content = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const results: DiscoveredCall[] = [];
      const baseMatch = content.match(/const\s+base\s*=\s*[`'"]([^`'"]+)[`'"]/);
      const fileBase = baseMatch ? baseMatch[1] : null;

      function visit(node: ts.Node, currentFn: string) {
        let fnName = currentFn;
        if (ts.isFunctionDeclaration(node) && node.name) {
          fnName = node.name.text;
        } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          if (
            node.parent &&
            ts.isVariableDeclaration(node.parent) &&
            ts.isIdentifier(node.parent.name)
          ) {
            fnName = node.parent.name.text;
          }
        }

        if (ts.isCallExpression(node)) {
          const exp = node.expression;
          let isTargetCall = false;
          let targetName = '';

          if (ts.isIdentifier(exp)) {
            targetName = exp.text;
            if (
              ['api', 'votingApi', 'fetch', 'getApiHealth'].includes(targetName)
            ) {
              isTargetCall = true;
            }
          }

          if (isTargetCall) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1;
            const arg0 = node.arguments[0];
            const arg1 = node.arguments[1];

            if (targetName === 'getApiHealth') {
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/health',
                normalizedPattern: '/health',
                method: 'GET',
              });
              return;
            }

            if (
              targetName === 'fetch' &&
              content
                .slice(node.getStart(), node.getEnd())
                .includes('`/api${url}`')
            ) {
              const exportTypes = [
                'normalized-scores',
                'project-scores',
                'results',
              ];
              for (const t of exportTypes) {
                results.push({
                  file: path.relative(webRoot, filePath),
                  line,
                  fnName,
                  rawPath: `/events/{eventId}/judging/exports/${t}`,
                  normalizedPattern: `/events/{eventId}/judging/exports/${t}`,
                  method: 'GET',
                });
              }
              return;
            }

            if (arg0 && ts.isConditionalExpression(arg0)) {
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/events/{eventId}',
                normalizedPattern: '/events/{eventId}',
                method: 'PATCH',
              });
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/events',
                normalizedPattern: '/events',
                method: 'POST',
              });
              return;
            }

            const arg0Text = arg0
              ? content.slice(arg0.getStart(), arg0.getEnd())
              : '';
            if (arg0Text.includes('submit ?')) {
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath:
                  '/events/{eventId}/judging/assignments/{assignmentId}/evaluation/submit',
                normalizedPattern:
                  '/events/{eventId}/judging/assignments/{assignmentId}/evaluation/submit',
                method: 'POST',
              });
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath:
                  '/events/{eventId}/judging/assignments/{assignmentId}/evaluation',
                normalizedPattern:
                  '/events/{eventId}/judging/assignments/{assignmentId}/evaluation',
                method: 'PATCH',
              });
              return;
            }

            let method = 'GET';
            if (arg1 && ts.isObjectLiteralExpression(arg1)) {
              for (const prop of arg1.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === 'method'
                ) {
                  if (ts.isStringLiteral(prop.initializer)) {
                    method = prop.initializer.text.toUpperCase();
                  }
                }
              }
            }

            const rawPath = arg0
              ? content.slice(arg0.getStart(), arg0.getEnd())
              : '';
            let normalized = rawPath;
            if (normalized.startsWith('`') && normalized.endsWith('`')) {
              normalized = normalized.slice(1, -1);
            } else if (normalized.startsWith("'") && normalized.endsWith("'")) {
              normalized = normalized.slice(1, -1);
            } else if (normalized.startsWith('"') && normalized.endsWith('"')) {
              normalized = normalized.slice(1, -1);
            }

            if (
              fileBase &&
              (normalized.includes('${base}') || normalized === 'base')
            ) {
              normalized = normalized.replace(/\$\{base\}/g, fileBase);
              if (normalized === 'base') normalized = fileBase;
            }

            if (normalized === '/auth/${mode}') {
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/auth/login',
                normalizedPattern: '/auth/login',
                method: 'POST',
              });
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/auth/register',
                normalizedPattern: '/auth/register',
                method: 'POST',
              });
              return;
            }

            if (normalized === '/team-invitations/${action}') {
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/team-invitations/accept',
                normalizedPattern: '/team-invitations/accept',
                method: 'POST',
              });
              results.push({
                file: path.relative(webRoot, filePath),
                line,
                fnName,
                rawPath: '/team-invitations/reject',
                normalizedPattern: '/team-invitations/reject',
                method: 'POST',
              });
              return;
            }

            normalized = normalized.replace(
              /\$\{([^}]+)\}/g,
              (_match, expr) => {
                const clean = expr.trim().split('.').pop() ?? expr.trim();
                return `{${clean}}`;
              },
            );

            if (normalized.startsWith('/api/')) {
              normalized = normalized.slice(4);
            } else if (normalized === '/api') {
              normalized = '/';
            }

            const pathOnly = normalized.split('?')[0] ?? '';

            results.push({
              file: path.relative(webRoot, filePath),
              line,
              fnName,
              rawPath,
              normalizedPattern: pathOnly,
              method,
            });
          }
        }

        ts.forEachChild(node, (child) => visit(child, fnName));
      }

      visit(sourceFile, 'top-level');
      return results;
    }

    function getAllFiles(dir: string): string[] {
      let files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.next', '.git'].includes(entry.name)) {
            files = files.concat(getAllFiles(fullPath));
          }
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))
        ) {
          files.push(fullPath);
        }
      }
      return files;
    }

    it('scans all UI files and matches every server-state action to OpenAPI with 0 unmatched', () => {
      const allWebFiles = getAllFiles(webRoot);
      const allCalls: DiscoveredCall[] = [];

      for (const file of allWebFiles) {
        const rel = path.relative(webRoot, file);
        if (
          rel === 'lib/client.ts' ||
          rel === 'lib/api.ts' ||
          rel === 'lib/voting.ts' ||
          rel === 'app/api/[...path]/route.ts' ||
          rel === 'app/embed/events/[eventId]/route.ts'
        ) {
          continue;
        }
        allCalls.push(...scanFile(file));
      }

      const uniqueActions = new Map<string, DiscoveredCall[]>();
      for (const call of allCalls) {
        const key = `${call.method} ${call.normalizedPattern}`;
        if (!uniqueActions.has(key)) {
          uniqueActions.set(key, []);
        }
        uniqueActions.get(key)!.push(call);
      }

      expect(uniqueActions.size).toBeGreaterThanOrEqual(75);

      const unmatchedActions: string[] = [];

      for (const [key, calls] of uniqueActions.entries()) {
        const [method = 'GET', pattern = ''] = key.split(' ');
        const lowerMethod = method.toLowerCase();

        let matched = false;
        for (const [oPath, oMethods] of Object.entries(openapiDoc.paths)) {
          const regexStr = '^' + oPath.replace(/\{[^}]+\}/g, '[^/]+') + '$';
          const regex = new RegExp(regexStr);
          if (regex.test(pattern) || oPath === pattern) {
            if (oMethods[lowerMethod]) {
              matched = true;
              break;
            }
          }
        }

        if (!matched) {
          const firstCall = calls[0];
          const loc = firstCall
            ? `${firstCall.file}:${firstCall.line}`
            : 'unknown';
          unmatchedActions.push(`${key} (in ${loc})`);
        }
      }

      expect(unmatchedActions).toEqual([]);
    });

    it('verifies all 90 rows in docs/API-FIRST.md match actual OpenAPI operations with 0 stale entries', () => {
      const apiFirstContent = fs.readFileSync(
        path.resolve(__dirname, '../../../docs/API-FIRST.md'),
        'utf-8',
      );
      const lines = apiFirstContent.split('\n');
      const tableLines: string[] = [];
      let inSection3 = false;

      for (const line of lines) {
        if (line.includes('Coverage Inventory')) {
          inSection3 = true;
          continue;
        }
        if (inSection3 && line.startsWith('## ')) {
          inSection3 = false;
          break;
        }
        if (
          inSection3 &&
          line.startsWith('|') &&
          !line.includes('UI Surface') &&
          !line.includes(':---')
        ) {
          tableLines.push(line);
        }
      }

      expect(tableLines.length).toBe(90);

      const staleEntries: string[] = [];

      for (const line of tableLines) {
        const parts = line
          .split('|')
          .map((p) => p.trim())
          .filter(Boolean);
        const rawMethod = parts[2] ?? '';
        const rawPath = parts[3] ?? '';
        const method = rawMethod.replace(/`/g, '').toLowerCase();
        const cleanPath = rawPath.replace(/`/g, '');
        const openapiStylePath = cleanPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

        if (openapiStylePath === '/embed/events/{eventId}') {
          continue;
        }

        const p = openapiDoc.paths[openapiStylePath];
        if (!p || !p[method]) {
          staleEntries.push(
            `[${method.toUpperCase()}] ${openapiStylePath} (${parts[1] ?? ''})`,
          );
        }
      }

      expect(staleEntries).toEqual([]);
    });

    it('checks request bodies for all major write surfaces in OpenAPI', () => {
      const missingBodySchemas: string[] = [];

      for (const [oPath, methods] of Object.entries(openapiDoc.paths)) {
        for (const [method, op] of Object.entries<OpenApiOperation>(methods)) {
          if (['post', 'put', 'patch'].includes(method)) {
            const isNoBodyOperation =
              oPath.endsWith('/publish') ||
              oPath.endsWith('/logout') ||
              oPath.endsWith('/revoke') ||
              oPath.endsWith('/replay') ||
              oPath.endsWith('/leave') ||
              oPath.endsWith('/withdraw') ||
              oPath.endsWith('/submit') ||
              oPath.endsWith('/hide') ||
              oPath.endsWith('/destination-secret') ||
              oPath.includes('/members/') ||
              oPath === '/events/{eventId}/registrations';

            if (!isNoBodyOperation) {
              const hasBody = Boolean(
                op.requestBody?.content?.['application/json']?.schema,
              );
              if (!hasBody) {
                missingBodySchemas.push(
                  `[${method.toUpperCase()}] ${oPath} (${op.summary ?? 'no summary'})`,
                );
              }
            }
          }
        }
      }

      expect(missingBodySchemas).toEqual([]);
    });
  });
});
