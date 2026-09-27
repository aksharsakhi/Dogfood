import type { ApiError } from '@dogfood/contracts';
import type { Event } from './client';

export type VotingMode = Event['votingAccessMode'];

export interface VotingConfig {
  accessMode: VotingMode;
  votingOpensAt: string | null;
  votingClosesAt: string | null;
  votingConfigLocked: boolean;
}

export interface BallotProject {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string;
}

export interface BallotResponse {
  items: BallotProject[];
  alreadyVoted: boolean;
}

export interface CommunityResults {
  items: Array<{ projectId: string; title: string; votes: number }>;
}

export interface VisibleComment {
  id: string;
  body: string;
  createdAt: string;
}

export interface CommentPage {
  items: VisibleComment[];
  nextCursor: string | null;
}

export interface VotingAuditItem {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  metadata: { reason?: string; relatedIdentityCount?: number } | null;
}

export interface VotingAuditPage {
  items: VotingAuditItem[];
  nextCursor: string | null;
}

export class VotingUiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
  }
}

export async function votingRequest<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH'; body?: object },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as ApiError;
    const retryHeader = Number(response.headers.get('retry-after'));
    const retryMessage = /retry after (\d+) seconds/i.exec(error.message ?? '');
    const retryAfterSeconds =
      Number.isFinite(retryHeader) && retryHeader > 0
        ? retryHeader
        : retryMessage
          ? Number(retryMessage[1])
          : null;
    throw new VotingUiError(
      error.code ?? 'REQUEST_FAILED',
      response.status,
      error.message ?? 'Request failed.',
      retryAfterSeconds,
    );
  }
  return data as T;
}

export function votingTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'a time the organizer has not set';
}

export function votingErrorMessage(
  error: unknown,
  window?: { votingOpensAt: string | null; votingClosesAt: string | null },
): string {
  if (!(error instanceof VotingUiError))
    return error instanceof Error ? error.message : 'Request failed.';
  switch (error.code) {
    case 'UNAUTHENTICATED':
      return 'Log in with your account to take part in this event.';
    case 'INVALID_VOTER_TOKEN':
      return 'This browser voting credential is invalid. Use the same browser that opened the ballot.';
    case 'WRONG_VOTING_MODE':
      return 'This identity does not match the event’s voting access mode. Refresh the page and use the selected method.';
    case 'EMAIL_REQUIRED':
      return 'Enter an email address to use this event’s email-string ballot.';
    case 'SELF_VOTE_FORBIDDEN':
      return 'You cannot vote for a project submitted by your own team.';
    case 'ALREADY_VOTED':
      return 'This voting identity has already cast its one vote for this event.';
    case 'VOTING_NOT_OPEN':
      return `Voting has not opened. It opens at ${votingTime(window?.votingOpensAt ?? null)}.`;
    case 'VOTING_CLOSED':
      return `Voting has closed at ${votingTime(window?.votingClosesAt ?? null)}.`;
    case 'RESULTS_HIDDEN':
      return `Results are visible after voting closes at ${votingTime(window?.votingClosesAt ?? null)}.`;
    case 'VOTING_MODE_LOCKED':
      return 'The access mode is locked because a voting identity already exists. The voting window can still be changed.';
    case 'RATE_LIMITED':
      return error.retryAfterSeconds
        ? `Too many attempts. Try again in ${error.retryAfterSeconds} seconds.`
        : 'Too many attempts. Please try again later.';
    case 'GALLERY_HIDDEN':
    case 'PROJECT_NOT_FOUND':
      return 'This project is not currently available on the public ballot.';
    case 'INVALID_COMMENT_CURSOR':
      return 'The comment page is no longer available. Reload comments from the first page.';
    default:
      if (error.status === 403)
        return 'Your account is not allowed to perform this action for this event.';
      if (error.status === 401)
        return 'Log in or provide the identity required for this event.';
      return error.message;
  }
}
