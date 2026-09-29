// #982 (STR-04): a decoded page reaches the main thread by transfer — the worker's own block, no
// copy on arrival —, and the shared-memory arena it used to be copied out of is gone. Port of the
// audit's `transport_bench.ts`: the page develop served, which the in-place decode returns, is the
// oracle, and the pool's page must equal it value by value (E0) on random pages and on the audit's
// edge cases: signed zeros, the one-triangle page, the maximal page, an empty and a truncated page
// (refused with develop's cause), and NaN or ±Infinity, which no page can carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageDecodePool } from './pool.ts';
import { restorePageDecode } from './task.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { edgePages, nonFinite, pageGap, randomPage, seeded } from './randomPages.fixture.ts';
import {
  NodeDomWorker,
  withNodeWorkerShim,
} from '../../../../../bench/oracles/browser/pageDecodeNodeWorker.ts';
import type { PageDecodeAnswer, PageDecodeDone } from '../../../../sdk-core/src/index.ts';

const MAX = 16 * 1024 * 1024;

/** `pages` decoded by a started pool of two workers, answers in submission order. */
async function byPool(pages: Uint8Array[]): Promise<PageDecodeAnswer[]> {
  const pool = createPageDecodePool(2);
  assert.equal(await pool.start(), true, 'the pool must start');
  try {
    return await Promise.all(
      pages.map((page) => pool.submit('decode', page.slice().buffer as ArrayBuffer, MAX).answer),
    );
  } finally {
    pool.retire();
  }
}

test('a page decoded in a worker arrives by transfer, identical to develop (E0)', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const random = seeded(982);
    const pages = edgePages(random);
    for (let i = 0; i < 200; i++) pages.push(randomPage(random, 3 + Math.floor(random() * 600)));
    for (const [rank, answer] of (await byPool(pages)).entries()) {
      assert.equal(answer.ok, true, answer.ok ? '' : answer.message);
      const { decoded } = answer as PageDecodeDone;
      const page = restorePageDecode(decoded!);
      // The page's views sit on the very block the worker transferred: nothing was copied.
      assert.equal(page.indices.buffer, decoded!.block);
      assert.equal(decoded!.block.byteLength, decoded!.decodedBytes);
      assert.equal(pageGap(page, decodeGeometryPage(pages[rank].slice(), MAX)), null, `${rank}`);
    }
  }));

test('an empty or truncated page refuses by transfer with develop cause; NaN and ±Inf never enter', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    for (const encode of nonFinite) assert.throws(encode, /PAGE_ATTRIBUTE_NONFINITE/);
    const refused = [new Uint8Array(0), randomPage(seeded(7), 30).slice(0, 100)];
    for (const [rank, answer] of (await byPool(refused)).entries()) {
      assert.equal(answer.ok, false, `page ${rank} must be refused`);
      const { message } = answer as { message: string };
      assert.throws(() => decodeGeometryPage(refused[rank].slice(), MAX), { message });
    }
  }));
