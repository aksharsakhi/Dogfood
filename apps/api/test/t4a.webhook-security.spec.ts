import {
  isBlockedAddress,
  resolvePublicAddress,
  verifyWebhookSignature,
  webhookSignature,
} from '../src/modules/webhooks/webhook-security';

describe('T4A webhook destination and signature security', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.1.2',
    '192.168.1.9',
    '169.254.169.254',
    '100.64.0.4',
    '::1',
    'fc00::1',
    'fd12::abcd',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks private or special address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    'https://localhost/hook',
    'https://api.localhost/hook',
    'https://printer.local/hook',
    'https://metadata.google.internal/latest',
    'http://hooks.example.com/hook',
    'https://user:pass@hooks.example.com/hook',
    'https://127.0.0.1/hook',
    'https://[::1]/hook',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(resolvePublicAddress(url)).rejects.toThrow();
  });

  it('rejects DNS answers containing a private address even when another answer is public', async () => {
    await expect(
      resolvePublicAddress('https://hooks.example.test/path', async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '192.168.1.22', family: 4 },
      ]),
    ).rejects.toThrow('public addresses');
  });

  it('accepts public HTTPS DNS targets and pins one resolved address', async () => {
    await expect(
      resolvePublicAddress('https://hooks.example.test/path', async () => [
        { address: '8.8.8.8', family: 4 },
      ]),
    ).resolves.toMatchObject({ address: { address: '8.8.8.8', family: 4 } });
  });

  it('signs exact body and binds timestamp, event, and delivery identifiers', () => {
    const secret = 'secret';
    const timestamp = '2026-09-27T10:00:00Z';
    const deliveryId = 'delivery-1';
    const eventType = 'project.created';
    const body = '{"a":1}';
    const valid = webhookSignature(
      secret,
      timestamp,
      deliveryId,
      eventType,
      body,
    );
    expect(
      verifyWebhookSignature(
        valid,
        secret,
        timestamp,
        deliveryId,
        eventType,
        body,
      ),
    ).toBe(true);
    expect(
      verifyWebhookSignature(
        valid,
        'wrong-secret',
        timestamp,
        deliveryId,
        eventType,
        body,
      ),
    ).toBe(false);
    expect(
      verifyWebhookSignature(
        valid,
        secret,
        timestamp,
        deliveryId,
        eventType,
        '{"a":2}',
      ),
    ).toBe(false);
    expect(
      verifyWebhookSignature(
        valid,
        secret,
        timestamp,
        'delivery-2',
        eventType,
        body,
      ),
    ).toBe(false);
  });
});
