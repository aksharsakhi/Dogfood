/** Authorization must combine event membership with resource-specific context. */
export type EventRole = 'PARTICIPANT' | 'JUDGE' | 'ORGANIZER';
export interface SessionPrincipal {
  userId: string;
  sessionId: string;
  platformRoles: readonly 'ADMIN'[];
}
