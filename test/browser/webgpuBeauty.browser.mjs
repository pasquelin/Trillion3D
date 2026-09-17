import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { routeBrowserFixtures } from '../appui/browserFixtureServer.mjs';
const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'browserFixtures');
const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  await page.goto(
    (process.env.LAB_URL ?? 'http://localhost:5174') + '/?test=15-virtualized-integration',
  );
  await routeBrowserFixtures(page, fixtureDirectory);
  const result = await page.evaluate(() =>
    import('/__wg-fixture/beautyRun.mjs').then((m) => m.run()),
  );
  console.log(
    JSON.stringify(
      result.results.map((s) => ({ name: s.name, reference: s.reference, webgpu: s.webgpu })),
      null,
      2,
    ),
  );
  const output = process.env.BEAUTY_RESULT ?? '/tmp/webgpu-beauty-result.json';
  await writeFile(output, JSON.stringify(result, null, 2));
  assert.deepEqual(result.errors, []);
  for (const sample of result.results) {
    for (const phase of [
      'material-textures',
      'material-textures-ready',
      'render-capabilities',
      'first-readback',
    ])
      assert.ok(
        sample.events.some((event) => event.phase === phase),
        `${sample.name}: missing log ${phase}`,
      );
    assert.ok(
      !sample.events.some((event) => /failed|uncaptured-error/.test(event.phase)),
      `${sample.name}: GPU diagnostic error`,
    );
    assert.ok(
      !sample.capabilities.unsupported.includes('visibility buffer'),
      'real visibility shader required',
    );
    for (const point of sample.samples) {
      const error = Math.max(
        ...point.reference.slice(0, 3).map((c, i) => Math.abs(c - point.webgpu[i])),
      );
      assert.ok(
        error <= 2,
        `${sample.name} (${point.x},${point.y}): reference ${point.reference}, WebGPU ${point.webgpu}, error ${error}`,
      );
    }
  }
} finally {
  await browser.close();
}
