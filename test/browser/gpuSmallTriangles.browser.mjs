import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeBrowserFixtures } from '../appui/browserFixtureServer.mjs';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'browserFixtures');
const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.WG_URL ?? 'http://127.0.0.1:5177/test/browser-test.html');
  await routeBrowserFixtures(page, fixtureDirectory);
  const result = await page.evaluate(() =>
    import('/__wg-fixture/smallTrianglesRun.mjs').then((m) => m.run()),
  );
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.shaderErrors, []);
  assert.equal(result.validation, null);
  assert.deepEqual(result.errors, []);
  const expected = [
    { id: 1 << 16, depth: 0.5 },
    { id: 1 << 16, depth: 0.5 },
    { id: 2 << 16, depth: 0.25 },
    { id: 0, depth: 1 },
    { id: 1 << 16, depth: 0.5 },
  ];
  for (let i = 0; i < expected.length; i++) {
    const sample = result.samples[i];
    assert.equal(sample.centerId, expected[i].id, sample.name);
    assert.equal(sample.outerId, 0, sample.name);
    assert.ok(Math.abs(sample.centerDepth - expected[i].depth) < 1e-4, sample.name);
  }
  assert.equal(
    result.samples[4].oldCenterId,
    0,
    'current camera matrix replaces the previous raster location',
  );
} finally {
  await browser.close();
}
