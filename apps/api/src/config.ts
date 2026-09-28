import { createHash } from 'node:crypto';
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

  @IsString()
  @MinLength(32)
  WEBHOOK_ENCRYPTION_KEY!: string;

  @IsString()
  JUDGE_RECORD_SIGNING_KEY_SEED!: string;

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
    env.NODE_ENV === 'production' &&
    createHash('sha256').update(env.VOTING_TOKEN_SECRET).digest('hex') ===
      '575378bc65b41872209d14d3a598dd26f6c49c4e3c21391066cebd0f70ab6e64'
  ) {
    throw new Error(
      'VOTING_TOKEN_SECRET is the public local/demo default; production must provide an independently generated secret.',
    );
  }
  if (
    env.NODE_ENV === 'production' &&
    typeof env.WEBHOOK_ENCRYPTION_KEY === 'string' &&
    createHash('sha256').update(env.WEBHOOK_ENCRYPTION_KEY).digest('hex') ===
      'e8365975051ad0b393da4833b2078399d8005abbddd843c91f948b77cdcea951'
  ) {
    throw new Error(
      'WEBHOOK_ENCRYPTION_KEY is the public local/demo default; production must provide an independently generated secret.',
    );
  }
  if (
    !/^(?!0{64}$)[a-fA-F0-9]{64}$/.test(env.JUDGE_RECORD_SIGNING_KEY_SEED ?? '')
  ) {
    throw new Error(
      'JUDGE_RECORD_SIGNING_KEY_SEED is required at API startup and must be an independently generated 32-byte hex seed (64 hex characters).',
    );
  }
  if (
    env.NODE_ENV === 'production' &&
    env.JUDGE_RECORD_SIGNING_KEY_SEED ===
      '02940e92f45afb8024a031d0b91d0587c6191102468df2eb65a9f27d41e785e6'
  ) {
    throw new Error(
      'JUDGE_RECORD_SIGNING_KEY_SEED is the public local/demo default; production must provide an independently generated seed.',
    );
  }
  if (
    typeof env.WEBHOOK_ENCRYPTION_KEY !== 'string' ||
    env.WEBHOOK_ENCRYPTION_KEY.replace(/\s/g, '').length < 32
  ) {
    throw new Error(
      'WEBHOOK_ENCRYPTION_KEY is required at API startup and must contain at least 32 non-whitespace characters.',
    );
  }
  if (
    validateSync(env).length ||
    !/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')
  ) {
    throw new Error(
      'Invalid environment: check DATABASE_URL, VOTING_TOKEN_SECRET, WEBHOOK_ENCRYPTION_KEY, JUDGE_RECORD_SIGNING_KEY_SEED, API_PORT, WEB_ORIGIN and NODE_ENV.',
    );
  }
  return env;
}
