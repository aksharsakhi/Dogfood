import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { config } from 'dotenv';
import { resolve } from 'node:path';

class Environment {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT = 4000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  VOTING_TOKEN_SECRET!: string;

  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  WEB_ORIGIN = 'http://localhost:3000';
}
export function loadEnvironment() {
  config({ path: resolve(__dirname, '../../../.env'), quiet: true });
  const env = plainToInstance(Environment, {
    ...process.env,
    API_PORT: Number(process.env.API_PORT ?? 4000),
  });
  if (
    typeof env.VOTING_TOKEN_SECRET !== 'string' ||
    env.VOTING_TOKEN_SECRET.replace(/\s/g, '').length < 32
  ) {
    throw new Error(
      'VOTING_TOKEN_SECRET is required at API startup and must contain at least 32 non-whitespace characters.',
    );
  }
  if (
    validateSync(env).length ||
    !/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')
  ) {
    throw new Error(
      'Invalid environment: check DATABASE_URL, VOTING_TOKEN_SECRET, API_PORT, WEB_ORIGIN and NODE_ENV.',
    );
  }
  return env;
}
