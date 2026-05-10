// Open an MHTML file in a clean Chromium and screenshot it for fidelity check.
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const [, , inputPath, outPath] = process.argv;
if (!inputPath || !outPath) {
  console.error('Usage: render-mhtml.mjs <input.mhtml> <output.png>');
  process.exit(1);
}
const input = resolve(inputPath);
const out = resolve(outPath);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`file://${input}`, { waitUntil: 'load' });
// Give the snapshot a beat to render; MHTML still hydrates JS.
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: false });
console.log(`wrote ${out}`);
await browser.close();
