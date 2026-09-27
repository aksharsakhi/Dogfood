import type { ApiError } from '@dogfood/contracts';
export interface User {
  id: string;
  email: string;
  displayName: string;
  status: string;
}
export interface Event {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  rules: string | null;
  eligibility: string | null;
  status: string;
  visibility: string;
  galleryVisibility: 'HIDDEN' | 'AFTER_SUBMISSIONS_CLOSE' | 'PUBLIC';
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  submissionOpensAt: string | null;
  submissionClosesAt: string | null;
  judgingOpensAt: string | null;
  judgingClosesAt: string | null;
  resultsPublishAt: string | null;
  minTeamSize: number;
  maxTeamSize: number;
  timezone: string;
}
export interface Registration {
  id: string;
  status: string;
  user?: User;
}
export interface Team {
  id: string;
  eventId: string;
  name: string;
  slug: string;
  status: string;
  members: Array<{ id: string; userId: string; role: string; user: User }>;
}
export interface Track {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  maxSubmissions?: number | null;
}
export interface Prize {
  id: string;
  name: string;
  trackId: string | null;
  description?: string | null;
  position?: number | null;
  amount?: string | number | null;
  currency?: string | null;
}
export interface TeamInvitation {
  id: string;
  email: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
}
export interface Project {
  id: string;
  eventId: string;
  teamId: string;
  trackId: string | null;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  repositoryUrl: string | null;
  demoUrl: string | null;
  status: string;
}
export interface Submission {
  id: string;
  version: number;
  title: string;
  description: string;
  repositoryUrl: string | null;
  demoUrl: string | null;
  status: string;
  submittedAt: string | null;
}
export interface GalleryProject {
  id: string;
  slug: string;
  eventId: string;
  trackId: string | null;
  trackName: string | null;
  projectName: string;
  tagline: string | null;
  teamName: string;
  version: number;
  title: string;
  description: string;
  repositoryUrl: string | null;
  demoUrl: string | null;
  submittedAt: string;
}
export async function api<T>(
  path: string,
  options?: { method?: string; body?: object },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as ApiError;
    throw new Error(`${error.code}: ${error.message}`);
  }
  return data as T;
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}
