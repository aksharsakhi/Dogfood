import { loadEnvironment } from '../src/config';

describe('voting and webhook secret boot configuration', () => {
  const previous = process.env.VOTING_TOKEN_SECRET;
  const previousWebhook = process.env.WEBHOOK_ENCRYPTION_KEY;
  const previousJudgeRecordSeed = process.env.JUDGE_RECORD_SIGNING_KEY_SEED;
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (previous === undefined) delete process.env.VOTING_TOKEN_SECRET;
    else process.env.VOTING_TOKEN_SECRET = previous;
    if (previousWebhook === undefined)
      delete process.env.WEBHOOK_ENCRYPTION_KEY;
    else process.env.WEBHOOK_ENCRYPTION_KEY = previousWebhook;
    if (previousJudgeRecordSeed === undefined)
      delete process.env.JUDGE_RECORD_SIGNING_KEY_SEED;
    else process.env.JUDGE_RECORD_SIGNING_KEY_SEED = previousJudgeRecordSeed;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it('fails before API creation when the secret is missing', () => {
    process.env.VOTING_TOKEN_SECRET = '';
    expect(() => loadEnvironment()).toThrow(
      'VOTING_TOKEN_SECRET is required at API startup and must contain at least 32 non-whitespace characters.',
    );
  });

  it('does not count whitespace toward the required secret length', () => {
    process.env.VOTING_TOKEN_SECRET = `${'x'.repeat(15)} ${'x'.repeat(16)}`;
    expect(() => loadEnvironment()).toThrow(
      'VOTING_TOKEN_SECRET is required at API startup and must contain at least 32 non-whitespace characters.',
    );
  });

  it('rejects a weak webhook encryption key with fewer than 32 non-whitespace characters', () => {
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY = `${'x'.repeat(15)} ${'x'.repeat(16)}`;
    expect(() => loadEnvironment()).toThrow(
      'WEBHOOK_ENCRYPTION_KEY is required at API startup and must contain at least 32 non-whitespace characters.',
    );
  });

  it('accepts a separately supplied deterministic test secret', () => {
    const secret = 't3b-configuration-test-secret-32-chars-or-more';
    process.env.VOTING_TOKEN_SECRET = secret;
    process.env.WEBHOOK_ENCRYPTION_KEY =
      't4a-configuration-test-encryption-key-32-chars';
    const environment = loadEnvironment();
    expect(environment.VOTING_TOKEN_SECRET).toBe(secret);
    expect(environment.WEBHOOK_ENCRYPTION_KEY).toBe(
      't4a-configuration-test-encryption-key-32-chars',
    );
    expect(environment.WEBHOOK_ENCRYPTION_KEY).not.toBe(secret);
  });

  it('fails before API creation when the judge-record signing seed is missing', () => {
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY =
      't4a-configuration-test-encryption-key-32-chars';
    process.env.JUDGE_RECORD_SIGNING_KEY_SEED = '';
    expect(() => loadEnvironment()).toThrow(
      'JUDGE_RECORD_SIGNING_KEY_SEED is required at API startup and must be an independently generated 32-byte hex seed (64 hex characters).',
    );
  });

  it('rejects weak or malformed judge-record signing seeds', () => {
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY =
      't4a-configuration-test-encryption-key-32-chars';
    process.env.JUDGE_RECORD_SIGNING_KEY_SEED = 'deadbeef';
    expect(() => loadEnvironment()).toThrow(
      'JUDGE_RECORD_SIGNING_KEY_SEED is required at API startup and must be an independently generated 32-byte hex seed (64 hex characters).',
    );
  });

  it('rejects an all-zero judge-record signing seed', () => {
    process.env.NODE_ENV = 'test';
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY =
      't4a-configuration-test-encryption-key-32-chars';
    process.env.JUDGE_RECORD_SIGNING_KEY_SEED = '0'.repeat(64);
    expect(() => loadEnvironment()).toThrow(
      'JUDGE_RECORD_SIGNING_KEY_SEED is required at API startup and must be an independently generated 32-byte hex seed (64 hex characters).',
    );
  });

  it('rejects the public Compose demo seed in production mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY =
      't4a-configuration-test-encryption-key-32-chars';
    process.env.JUDGE_RECORD_SIGNING_KEY_SEED =
      '02940e92f45afb8024a031d0b91d0587c6191102468df2eb65a9f27d41e785e6';
    expect(() => loadEnvironment()).toThrow(
      'JUDGE_RECORD_SIGNING_KEY_SEED is the public local/demo default; production must provide an independently generated seed.',
    );
  });

  it('accepts a deterministic 32-byte Ed25519 seed independent of other secrets', () => {
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY =
      't4a-configuration-test-encryption-key-32-chars';
    process.env.JUDGE_RECORD_SIGNING_KEY_SEED =
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const environment = loadEnvironment();
    expect(environment.JUDGE_RECORD_SIGNING_KEY_SEED).toBe(
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    expect(environment.JUDGE_RECORD_SIGNING_KEY_SEED).not.toBe(
      environment.VOTING_TOKEN_SECRET,
    );
    expect(environment.JUDGE_RECORD_SIGNING_KEY_SEED).not.toBe(
      environment.WEBHOOK_ENCRYPTION_KEY,
    );
  });

  it('fails before API creation when the webhook encryption key is missing', () => {
    process.env.VOTING_TOKEN_SECRET =
      't3b-configuration-test-secret-32-chars-or-more';
    process.env.WEBHOOK_ENCRYPTION_KEY = '';
    expect(() => loadEnvironment()).toThrow(
      'WEBHOOK_ENCRYPTION_KEY is required at API startup and must contain at least 32 non-whitespace characters.',
    );
  });
});
