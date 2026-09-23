// First load of portal routes in headless Chrome, on a built site tree served by the docs server.
//
//   node scripts/site-first-load.ts [siteDir] [route ...]
//
// Prints, per route and over `SITE_LOAD_RUNS` cold loads (default 5, new context each): the median
// DOMContentLoaded and networkidle times since navigation start, the number of requests and the
// bytes transferred. Three's CDN modules are answered from node_modules so the network is not
// measured. A measurement, not a proof: it exits 0.
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Browser, Route } from 'playwright';
import { launchChrome } from '../bench/runner/chrome.ts';
import { createDocsServer, listen } from './docs-serve.ts';
import { SITE_OUTPUT } from './docs/site.ts';

const DEFAULT_ROUTES = ['#/en/learn/home', '#/en/lessons/shadow-casting-switch'];
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.174.0/';
const SUMMARY_KEYS = ['domContentLoaded', 'settled', 'requests', 'bytes'] as const;

interface LoadSample {
  domContentLoaded: number;
  settled: number;
  requests: number;
  bytes: number;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

async function loadOnce(browser: Browser, origin: string, route: string): Promise<LoadSample> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route(`${THREE}**`, async (handler: Route) => {
    const file = handler.request().url().slice(THREE.length);
    handler.fulfill({
      contentType: 'text/javascript',
      body: await readFile(resolve(import.meta.dirname, '../node_modules/three', file)),
    });
  });
  const page = await context.newPage();
  let requests = 0;
  let bytes = 0;
  page.on('response', async (response) => {
    requests += 1;
    bytes += Number((await response.allHeaders())['content-length'] ?? 0);
  });
  const started = performance.now();
  await page.goto(`${origin}/${route}`, { waitUntil: 'domcontentloaded' });
  const domContentLoaded = performance.now() - started;
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('main:not([aria-busy="true"])');
  const settled = performance.now() - started;
  await context.close();
  return { domContentLoaded, settled, requests, bytes };
}

const [siteDir = SITE_OUTPUT, ...routes] = process.argv.slice(2);
const runs = Number(process.env.SITE_LOAD_RUNS ?? 5);
const server = createDocsServer(resolve(siteDir));
const origin = `http://127.0.0.1:${await listen(server)}`;
const browser = await launchChrome({ headless: true });
try {
  for (const route of routes.length ? routes : DEFAULT_ROUTES) {
    const samples: LoadSample[] = [];
    for (let i = 0; i < runs; i += 1) samples.push(await loadOnce(browser, origin, route));
    const summary = Object.fromEntries(
      SUMMARY_KEYS.map((key) => [key, median(samples.map((sample) => sample[key]))]),
    );
    console.log(JSON.stringify({ route, runs, ...summary }));
  }
} finally {
  await browser.close();
  server.close();
}
