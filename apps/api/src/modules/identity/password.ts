import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const DUMMY_HASH =
  'scrypt$dogfood-dummy-user-salt$5e4cc09a59a59367008954077272884483d6a832fc578002007248593a9c5e1f134135e9f74105965fb8d26add56e968de7817f34335211426883525104738f5';
async function digest(password: string, salt: string): Promise<Buffer> {
  return (await derive(password, salt, 64)) as Buffer;
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await digest(password, salt)).toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  const parts = (stored ?? DUMMY_HASH).split('$');
  if (
    parts.length !== 3 ||
    parts[0] !== 'scrypt' ||
    !parts[1] ||
    !parts[2] ||
    !/^[0-9a-f]{128}$/.test(parts[2])
  )
    return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = await digest(password, parts[1]);
  return timingSafeEqual(expected, actual) && stored !== null;
}
