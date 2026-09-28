import { request as httpsRequest } from 'node:https';
import { resolvePublicAddress, webhookSignature } from './webhook-security';

const requestTimeoutMs = 5_000;
const maxResponseBytes = 4_096;

export class WebhookTransport {
  async send(
    urlText: string,
    secret: string,
    deliveryId: string,
    eventType: string,
    body: string,
  ): Promise<number> {
    const { url, address } = await resolvePublicAddress(urlText);
    const timestamp = new Date().toISOString();
    const signature = webhookSignature(
      secret,
      timestamp,
      deliveryId,
      eventType,
      body,
    );
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-dogfood-delivery': deliveryId,
            'x-dogfood-event': eventType,
            'x-dogfood-timestamp': timestamp,
            'x-dogfood-signature': signature,
          },
          timeout: requestTimeoutMs,
          servername: url.hostname,
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
        },
        (response) => {
          let bytes = 0;
          let completed = false;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxResponseBytes && !completed) {
              completed = true;
              response.destroy();
              resolve(502);
            }
          });
          response.on('end', () => {
            if (!completed) resolve(response.statusCode ?? 0);
          });
          response.on('error', () => {
            if (!completed) reject(new Error('network_error'));
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => reject(new Error('network_error')));
      req.end(body);
    });
  }
}
