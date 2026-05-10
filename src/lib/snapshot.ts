import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';

/**
 * Snapshot strategies for capturing a self-contained copy of a rendered page.
 *
 *   - cdpMhtml: uses CDP's Page.captureSnapshot to produce a single-file MHTML.
 *     Works regardless of the page's CSP (runs in the inspector context, not
 *     as a page-loaded script). Output is a single .mhtml file that opens in
 *     Chromium/Edge browsers. This is the v1 default for claude.ai/design
 *     because the page's CSP blocks SingleFile's external-script approach.
 *
 *   - rawHtml: page.content(), saved as .html. Final fallback; loses styles,
 *     images, scripts. Useful only as evidence the snapshot path ran at all.
 */

export interface SnapshotResult {
  path: string;
  bytes: number;
  format: 'mhtml' | 'html';
  strategy: 'cdp-mhtml' | 'raw-html';
}

export async function captureMhtml(page: Page, destPath: string): Promise<SnapshotResult> {
  const session = await page.context().newCDPSession(page);
  try {
    // CDP returns { data: string } where data is the MHTML body.
    const { data } = (await session.send('Page.captureSnapshot' as never, { format: 'mhtml' } as never)) as {
      data: string;
    };
    await writeFile(destPath, data, 'utf8');
    return {
      path: destPath,
      bytes: Buffer.byteLength(data, 'utf8'),
      format: 'mhtml',
      strategy: 'cdp-mhtml'
    };
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export async function captureRawHtml(page: Page, destPath: string): Promise<SnapshotResult> {
  const html = await page.content();
  await writeFile(destPath, html, 'utf8');
  return {
    path: destPath,
    bytes: Buffer.byteLength(html, 'utf8'),
    format: 'html',
    strategy: 'raw-html'
  };
}

/**
 * Snapshot the page using the best-available strategy, falling back if the
 * preferred one fails. Caller passes in the desired *base* path (without a
 * fixed extension); we append .mhtml or .html based on the strategy used.
 */
export async function captureSnapshot(page: Page, basePath: string): Promise<SnapshotResult> {
  try {
    return await captureMhtml(page, `${basePath}.mhtml`);
  } catch (err) {
    // Swallow and fall back. The error is informational only.
    process.stderr.write(
      `[ai-web-bridge] CDP MHTML capture failed: ${err instanceof Error ? err.message : String(err)} — falling back to raw HTML.\n`
    );
    return captureRawHtml(page, `${basePath}.html`);
  }
}
