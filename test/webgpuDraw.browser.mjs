import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeBrowserFixtures } from './browserFixtureServer.mjs';
const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'browserFixtures');
import {
  DRAW_SHADER,
  evaluateDrawCompact,
  indirectForDraw,
} from '../packages/sdk-browser/gpuDraw.ts';
import { VIS_SHADER, PAGE_INFO_STRIDE } from '../packages/sdk-browser/visibilityBuffer.ts';

const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
const cap = 192,
  maxVertexCount = 3;
// Canonical page IDs deliberately differ from both input and compacted positions.
const items = Array.from({ length: 130 }, (_, i) => ({
  pageIndex: 17 + ((i * 37) % 130),
  bin: (i * 7) % 3,
  rest: (i * 11) % 2,
  selectionIndex: i,
}));
const cases = [
  { name: 'six mixed slots across three workgroups', items },
  {
    name: 'selection mask filters before scatter',
    items,
    mask: Array.from({ length: cap }, (_, i) => (i % 4 < 2 ? 1 : 0)),
  },
  { name: 'selection mask rejects all pages', items, mask: Array(cap).fill(0) },
  {
    name: 'sparse slots replace previous contents',
    items: items.filter((item) => item.bin === 1).slice(0, 7),
  },
  { name: 'empty replaces previous contents', items: [] },
  {
    name: 'overflow emits no draws',
    items: Array.from({ length: cap + 1 }, (_, i) => items[i % items.length]),
  },
];
const selectedItems = (sample) =>
  sample.mask
    ? sample.items.filter((item) => sample.mask[item.selectionIndex] !== 0)
    : sample.items;
const expected = cases.map((sample) =>
  evaluateDrawCompact(selectedItems(sample), maxVertexCount, cap),
);
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>WebGeometry GPU scatter to visibility</title>');
});
await new Promise((ready, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', ready);
});
const address = server.address();
if (!address || typeof address === 'string') throw Error('HTTP listener unavailable');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  startedAt: new Date().toISOString(),
  shaders: {
    draw: createHash('sha256').update(DRAW_SHADER).digest('hex'),
    visibility: createHash('sha256').update(VIS_SHADER).digest('hex'),
  },
};
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await routeBrowserFixtures(page, fixtureDirectory);
  const result = await page.evaluate(
    (args) => import('/__wg-fixture/drawRun.mjs').then((module) => module.run(args)),
    {
      shader: DRAW_SHADER,
      visShader: VIS_SHADER,
      cases,
      cap,
      maxVertexCount,
      pageStride: PAGE_INFO_STRIDE,
    },
  );
  Object.assign(report, result);
  assert.ok(!result.unavailable, result.unavailable);
  assert.deepEqual(result.compilationErrors ?? [], []);
  assert.deepEqual(result.errors, []);
  assert.ok(!result.features.includes('indirect-first-instance'));
  for (let i = 0; i < cases.length; i++) {
    const actual = result.results[i],
      oracle = expected[i];
    assert.deepEqual(
      actual.instanceIds,
      [...oracle.instances],
      `${actual.name}: GPU instance permutation`,
    );
    assert.deepEqual(
      actual.commands,
      [...indirectForDraw(oracle)],
      `${actual.name}: indirect commands`,
    );
    for (let slot = 0; slot < 6; slot++) {
      const pages = oracle.overflow
        ? []
        : selectedItems(cases[i])
            .filter((item) => item.rest * 3 + item.bin === slot)
            .map((item) => item.pageIndex)
            .sort((a, b) => a - b);
      assert.deepEqual(
        actual.visiblePages[slot],
        pages,
        `${actual.name}: visibility slot ${slot} must consume GPU scatter`,
      );
      if (!oracle.overflow)
        assert.equal(
          actual.slotOffsets[slot],
          oracle.indirect[slot * 4 + 3],
          `${actual.name}: GPU storage slot start ${slot}`,
        );
    }
    assert.deepEqual(
      actual.visiblePages[6],
      [result.directPage],
      `${actual.name}: direct draw keeps canonical instance index`,
    );
  }
  assert.ok(
    result.results[0].slotOffsets.some(
      (offset) => (offset * 4) % result.minStorageBufferOffsetAlignment !== 0,
    ),
    'exercise slot starts that cannot be storage binding offsets',
  );
  report.status = 'passed';
  console.log(
    JSON.stringify({
      status: report.status,
      adapter: result.adapter,
      features: result.features,
      cases: result.results.map((sample) => ({
        name: sample.name,
        slotCounts: sample.visiblePages.slice(0, 6).map((pages) => pages.length),
      })),
    }),
  );
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    process.env.DRAW_RESULT ?? '/private/tmp/webgpu-draw-result.json',
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
