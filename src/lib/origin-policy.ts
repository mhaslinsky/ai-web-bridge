import type { Page } from 'playwright';

/** Thrown when a page is on a host outside the adapter's `allowed_origins`. */
export class OriginPolicyError extends Error {
  constructor(public readonly currentUrl: string, public readonly allowed: readonly string[]) {
    super(
      `Origin policy violation: page is at ${currentUrl}, but adapter only permits ${allowed.join(', ')}. ` +
        `Refusing to operate. Navigate to an allowed origin in the automation profile and retry.`
    );
    this.name = 'OriginPolicyError';
  }
}

/** True if `host` equals `allowedHost` or is a subdomain of it. */
export function hostMatches(host: string, allowedHost: string): boolean {
  if (host === allowedHost) return true;
  return host.endsWith(`.${allowedHost}`);
}

/** Throw OriginPolicyError unless `page` is on a host matching one in `allowedHosts`. */
export function assertAllowedOrigin(page: Page, allowedHosts: readonly string[]): void {
  const currentUrl = page.url();
  let currentHost: string;
  try {
    currentHost = new URL(currentUrl).host;
  } catch {
    throw new OriginPolicyError(currentUrl, allowedHosts);
  }
  const isAllowed = allowedHosts.some((allowedHost) => hostMatches(currentHost, allowedHost));
  if (!isAllowed) throw new OriginPolicyError(currentUrl, allowedHosts);
}
