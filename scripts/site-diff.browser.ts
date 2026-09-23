// Differential DOM render of every portal route between two built site trees, in headless Chrome.
//
//   node scripts/site-diff.browser.ts <beforeDir> <afterDir> [routeFilter]
//
// Both trees are served by the docs server. Each route is loaded on each side until `networkidle`,
// no `aria-busy`, then 1.5 s more, and `document.body` is serialised after normalising what is
// dynamic by nature: canvas contents and sizes, `disabled`, stat values and outputs, generated
// ids, frame metrics. A DOM-at-rest comparison, not a pixel claim. Differences are written under
// `.mesure/out/site-diff/` and the exit code is 1 when any route differs. A filter keeps the
// routes containing it, to look again at a few.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { routeThree } from '../tests/kit/server/threeRoute.ts';
import { launchChrome } from '../bench/runner/chrome.ts';
import { createDocsServer, listen } from './docs-serve.ts';
import { examples } from '../site/content/catalog.ts';
import { rawEntries } from '../site/app/portal/data.ts';
import { entryRoute, routeHref } from '../site/app/portal/routes.ts';
import type { Locale } from '../site/content/locale.ts';
import { measureOutput } from '../bench/core/paths.ts';

const SETTLE_MS = 1500;
const OUT = measureOutput('site-diff');
const LOCALES: Locale[] = ['en', 'fr'];

/** Every route the portal resolves: entries and examples in both locales, plus the fixed pages. */
export function portalRoutes() {
  const routes: string[] = [];
  for (const locale of LOCALES) {
    routes.push(routeHref({ locale, area: 'learn', id: 'home' }));
    for (const entry of rawEntries) routes.push(entryRoute(entry, locale));
    for (const { id } of examples) routes.push(routeHref({ locale, area: 'lessons', id }));
    routes.push(routeHref({ locale, area: 'lessons', id: '' }));
    routes.push(routeHref({ locale, area: 'lessons', id: 'engine-scene' }));
    routes.push(routeHref({ locale, area: 'api', id: '' }));
    routes.push(routeHref({ locale, area: 'reports', id: '' }));
    routes.push(routeHref({ locale, area: 'learn', id: 'no-such-page' }));
  }
  return [...new Set(routes)];
}

/** The body markup with dynamic values normalised, computed in the page. */
function normalisedBody() {
  const body = document.body.cloneNode(true) as HTMLElement;
  for (const canvas of body.querySelectorAll('canvas')) {
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    canvas.textContent = '';
  }
  for (const element of body.querySelectorAll('[disabled]')) element.removeAttribute('disabled');
  for (const element of body.querySelectorAll('.stat-value, .stat-desc, output, [data-metric]'))
    element.textContent = '#';
  return body.innerHTML
    .replace(/\b(id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '$1="#"')
    .replace(/\d+(\.\d+)? (ms|fps|MiB|KiB)\b/g, '# $2');
}

async function render(page: Page, origin: string, route: string) {
  await page.goto(`${origin}/${route}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(SETTLE_MS);
  return page.evaluate(normalisedBody);
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await routeThree(context);
  return context.newPage();
}

const [beforeDir, afterDir, filter = ''] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error('usage: node scripts/site-diff.browser.ts <beforeDir> <afterDir>');
  process.exit(2);
}
const servers = [createDocsServer(resolve(beforeDir)), createDocsServer(resolve(afterDir))];
const origins = await Promise.all(
  servers.map(async (server) => `http://127.0.0.1:${await listen(server)}`),
);
const browser = await launchChrome({ headless: true });
await mkdir(OUT, { recursive: true });
const differences: string[] = [];
try {
  const pages: Page[] = [await newPage(browser), await newPage(browser)];
  const routes = portalRoutes().filter((route) => route.includes(filter));
  for (const route of routes) {
    const [before, after] = await Promise.all(
      pages.map((page, side) => render(page, origins[side], route)),
    );
    if (before === after) continue;
    differences.push(route);
    const name = route.replace(/[^a-z0-9]+/gi, '-');
    await writeFile(resolve(OUT, `${name}.before.html`), before);
    await writeFile(resolve(OUT, `${name}.after.html`), after);
  }
  console.log(`${routes.length} routes, ${differences.length} differences`);
  for (const route of differences) console.log(`  differs: ${route}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
process.exitCode = differences.length ? 1 : 0;
