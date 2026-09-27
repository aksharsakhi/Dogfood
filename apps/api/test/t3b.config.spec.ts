import { loadEnvironment } from '../src/config';

describe('T3B voting secret boot configuration', () => {
  const previous = process.env.VOTING_TOKEN_SECRET;

  afterEach(() => {
    if (previous === undefined) delete process.env.VOTING_TOKEN_SECRET;
    else process.env.VOTING_TOKEN_SECRET = previous;
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

  it('accepts a separately supplied deterministic test secret', () => {
    const secret = 't3b-configuration-test-secret-32-chars-or-more';
    process.env.VOTING_TOKEN_SECRET = secret;
    expect(loadEnvironment().VOTING_TOKEN_SECRET).toBe(secret);
  });
});
