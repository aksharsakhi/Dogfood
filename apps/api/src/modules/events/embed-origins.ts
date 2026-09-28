import { fail } from '../../common/errors/domain-error';

/** Only exact HTTP(S) origins can become frame-ancestors sources. */
export function canonicalEmbedOrigins(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 50)
    fail(400, 'INVALID_EMBED_ORIGIN', 'Provide at most 50 web origins.');
  const origins = input.map((value: unknown) => {
    if (
      typeof value !== 'string' ||
      value.length > 2048 ||
      value !== value.trim() ||
      value.includes('\\') ||
      /\s/.test(value) ||
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !/^https?:\/\//i.test(value)
    )
      fail(400, 'INVALID_EMBED_ORIGIN', 'Use an exact HTTP or HTTPS origin.');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      fail(400, 'INVALID_EMBED_ORIGIN', 'Use an exact HTTP or HTTPS origin.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !/^[^/?#]+\/?$/.test(value.slice(value.indexOf('//') + 2)) ||
      url.hostname.includes('*')
    )
      fail(400, 'INVALID_EMBED_ORIGIN', 'Use an exact HTTP or HTTPS origin.');
    return url.origin;
  });
  return [...new Set(origins)].sort();
}

export function embedFrameAncestors(origins: readonly string[]): string {
  return origins.length
    ? `frame-ancestors 'self' ${origins.join(' ')}`
    : "frame-ancestors 'none'";
}
