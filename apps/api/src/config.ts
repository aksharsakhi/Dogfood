import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
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
    validateSync(env).length ||
    !/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')
  ) {
    throw new Error(
      'Invalid environment: check DATABASE_URL, API_PORT, WEB_ORIGIN and NODE_ENV.',
    );
  }
  return env;
}
