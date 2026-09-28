import { EventEmitter } from 'node:events';
import { WebhookTransport } from '../src/modules/webhooks/webhook-transport';

const mockHttpsRequest = jest.fn();
jest.mock('node:https', () => ({
  request: (...args: unknown[]) => mockHttpsRequest(...args),
}));

describe('T4A webhook transport redirect handling', () => {
  afterEach(() => mockHttpsRequest.mockReset());

  it('returns a redirect status without following a Location to a blocked target', async () => {
    mockHttpsRequest.mockImplementation((...args: unknown[]) => {
      const callback = args[2] as (
        response: EventEmitter & { statusCode: number },
      ) => void;
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
      };
      response.statusCode = 302;
      const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
      req.end = jest.fn(() => {
        process.nextTick(() => {
          callback(response);
          response.emit('end');
        });
      });
      return req;
    });
    const status = await new WebhookTransport().send(
      'https://8.8.8.8/hook',
      'test-secret',
      '00000000-0000-4000-8000-000000000001',
      'project.created',
      '{"schemaVersion":1}',
    );
    expect(status).toBe(302);
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
  });
});
