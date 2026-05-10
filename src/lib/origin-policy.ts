import type { Page } from 'playwright';

export class OriginPolicyError extends Error {
  constructor(public readonly currentUrl: string, public readonly allowed: readonly string[]) {
    super(
      `Origin policy violation: page is at ${currentUrl}, but adapter only permits ${allowed.join(', ')}. ` +
        `Refusing to operate. Navigate to an allowed origin in the automation profile and retry.`
    );
    this.name = 'OriginPolicyError';
  }
}

export function hostMatches(host: string, allowedHost: string): boolean {
  if (host === allowedHost) return true;
  return host.endsWith(`.${allowedHost}`);
}

export function assertAllowedOrigin(page: Page, allowed: readonly string[]): void {
  const url = page.url();
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    throw new OriginPolicyError(url, allowed);
  }
  const ok = allowed.some((a) => hostMatches(host, a));
  if (!ok) throw new OriginPolicyError(url, allowed);
}
