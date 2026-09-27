import type { EventRole, SessionPrincipal } from '@dogfood/shared';

export interface EventAuthorizationContext {
  principal: SessionPrincipal;
  eventId: string;
  activeMembershipRoles: readonly EventRole[];
}
/** Policies must load authoritative ownership/assignment state, never trust request roles. */
export interface ResourcePolicy<Resource> {
  canRead(
    context: EventAuthorizationContext,
    resource: Resource,
  ): Promise<boolean>;
}
