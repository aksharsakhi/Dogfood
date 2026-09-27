/** Shared wire contracts; implementation stays within the owning application. */
export interface ApiError {
  code: string;
  message: string;
  details: unknown;
  requestId: string;
}
export interface HealthResponse {
  status: 'ok';
  service: 'api';
}
export interface ReadyResponse {
  status: 'ready';
  database: 'connected';
}
