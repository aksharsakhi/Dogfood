import { HttpException } from '@nestjs/common';
/** Expected domain failures preserve the existing API error shape. */
export class DomainError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message, details: null }, status);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new DomainError(status, code, message);
}
