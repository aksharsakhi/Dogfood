import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export function webhookSignature(
  secret: string,
  timestamp: string,
  deliveryId: string,
  eventType: string,
  body: string,
): string {
  return `v1=${createHmac('sha256', secret)
    .update(`${timestamp}.${deliveryId}.${eventType}.${body}`)
    .digest('hex')}`;
}

export function verifyWebhookSignature(
  header: string,
  secret: string,
  timestamp: string,
  deliveryId: string,
  eventType: string,
  body: string,
): boolean {
  const expected = Buffer.from(
    webhookSignature(secret, timestamp, deliveryId, eventType, body),
  );
  const received = Buffer.from(header);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

const blockedHosts = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data',
  'metadata.tencentyun.com',
]);

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return null;
  return (
    (((parts[0]! << 24) >>> 0) |
      (parts[1]! << 16) |
      (parts[2]! << 8) |
      parts[3]!) >>>
    0
  );
}

function inV4(address: number, base: string, prefix: number): boolean {
  const network = ipv4Number(base)!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return true;
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, prefix]) => inV4(value, base as string, prefix as number));
  }
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (/^::ffff:(\d{1,3}\.){3}\d{1,3}$/.test(normalized))
    return isBlockedAddress(normalized.slice('::ffff:'.length));
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return isBlockedAddress(
      `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`,
    );
  }
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    first < 0x2000 ||
    first >= 0x4000 ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2001:0:') ||
    normalized.startsWith('2002:')
  );
}

export async function resolvePublicAddress(
  rawUrl: string,
  resolver: Resolver = async (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
): Promise<{ url: URL; address: ResolvedAddress }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL must be a valid HTTPS URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port === '0'
  )
    throw new Error(
      'Webhook URL must be a valid HTTPS URL without credentials.',
    );
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    blockedHosts.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    throw new Error(
      'Webhook destination resolves to a prohibited local or metadata host.',
    );

  const literalFamily = isIP(host);
  let addresses: ResolvedAddress[];
  if (literalFamily) addresses = [{ address: host, family: literalFamily }];
  else {
    let timeout: NodeJS.Timeout | undefined;
    addresses = await Promise.race([
      resolver(host).catch(() => []),
      new Promise<ResolvedAddress[]>((resolve) => {
        timeout = setTimeout(() => resolve([]), 5_000);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => isBlockedAddress(address))
  )
    throw new Error(
      'Webhook destination must resolve only to public addresses.',
    );
  return { url, address: addresses[0]! };
}
