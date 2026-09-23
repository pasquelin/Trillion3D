import assert from 'node:assert/strict';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { blankPageServer } from '../../kit/server/blankPage.ts';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { routeBrowserFixtures } from '../../kit/server/fixtureRoute.ts';
import {
  BASE_SLOTS,
  DRAW_ITEM_U32,
  DRAW_SHADER,
  drawBindEntries,
  evaluateDrawCompact,
  indirectForDraw,
} from '../../../packages/sdk-browser/src/gpu/draw/draw.ts';
import {
  VIS_SHADER,
  PAGE_INFO_STRIDE,
} from '../../../packages/sdk-browser/src/visibility/buffer.ts';
import { VIS_BINDINGS } from '../../../packages/sdk-browser/src/webgpu/core/bindLayout.ts';
import type { DrawItem } from '../../../packages/sdk-browser/src/gpu/draw/draw.ts';

const cap = 192,
  maxVertexCount = 3;
// Canonical page IDs deliberately differ from both input and compacted positions.
const items: DrawItem[] = Array.from({ length: 130 }, (_, i) => ({
  pageIndex: 17 + ((i * 37) % 130),
  bin: ((i * 7) % 3) as 0 | 1 | 2,
  rest: ((i * 11) % 2) as 0 | 1,
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
const selectedItems = (sample: (typeof cases)[number]) =>
  sample.mask
    ? sample.items.filter((item) => sample.mask![item.selectionIndex!] !== 0)
    : sample.items;
const expected = cases.map((sample) =>
  evaluateDrawCompact(selectedItems(sample), maxVertexCount, cap),
);
const { server, port } = await blankPageServer('Trillion3D GPU scatter to visibility');
const browser = await launchChrome({ headless: true });

interface DrawCaseResult {
  name: string;
  instanceIds: number[];
  commands: number[];
  visiblePages: number[][];
  slotOffsets: number[];
}

interface DrawRunResult {
  unavailable?: string;
  compilationErrors?: string[];
  errors: string[];
  features: string[];
  results: DrawCaseResult[];
  adapter: string;
  directPage: number;
  minStorageBufferOffsetAlignment: number;
}

interface DrawReport {
  startedAt: string;
  shaders: { draw: string; visibility: string };
  status?: string;
  failure?: string;
  finishedAt?: string;
}

const report: DrawReport = {
  startedAt: new Date().toISOString(),
  shaders: {
    draw: createHash('sha256').update(DRAW_SHADER).digest('hex'),
    visibility: createHash('sha256').update(VIS_SHADER).digest('hex'),
  },
};
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await routeBrowserFixtures(page, resolve(import.meta.dirname, '../support'));
  const result = (await page.evaluate(
    (args) => {
      const fixtureUrl = '/__wg-fixture/drawRun.ts';
      return import(fixtureUrl).then((module) => module.run(args));
    },
    {
      shader: DRAW_SHADER,
      visShader: VIS_SHADER,
      cases,
      cap,
      maxVertexCount,
      pageStride: PAGE_INFO_STRIDE,
      bindEntries: drawBindEntries(),
      slots: BASE_SLOTS,
      drawItemU32: DRAW_ITEM_U32,
      visBindings: VIS_BINDINGS,
    },
  )) as DrawRunResult;
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
