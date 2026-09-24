import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../../page/selection/selection.ts';
import type { WebgpuPagesCore } from '../runtime.ts';
import { acceptPage } from './pageApi.ts';

/** The slice of the runtime an arrival touches, with the gate counting its resource revisions. */
function runtime() {
  const rec = { url: 'p', triangles: 1, indexBytes: 0 } as unknown as PageRec;
  const touched: number[] = [];
  let resources = 0;
  const rt = {
    run: {
      frame: 0,
      pageArrayEpoch: 0,
      deferredDrops: new Set<string>(),
      gate: { resourcesChanged: () => resources++ },
    },
    diag: { traceDiagnostic: () => {} },
    layout: { rows: { touchPage: (page: number) => touched.push(page), pageIndexOf: () => 7 } },
    setup: {
      byUrl: new Map([['p', [rec]]]),
      sourceBytes: new Map(),
      tracking: {},
      bootstrapUrls: new Set<string>(),
    },
  } as unknown as WebgpuPagesCore;
  return { rt, rec, touched, resources: () => resources };
}

test('an arrival the image does not read keeps the bytes but moves neither epoch nor revision', () => {
  const t = runtime();
  acceptPage(t.rt, 'p', new Uint32Array([0, 1, 2]), undefined, () => false);
  assert.ok(t.rec.array, 'the bytes are kept for when the camera asks for them');
  assert.deepEqual(t.touched, [7], 'the page is still named to the journal');
  assert.equal(t.rt.run.pageArrayEpoch, 0);
  assert.equal(t.resources(), 0);
});

test('an arrival the image reads, or one with no verdict, invalidates the held frame', () => {
  for (const affectsImage of [() => true, undefined]) {
    const t = runtime();
    acceptPage(t.rt, 'p', new Uint32Array([0, 1, 2]), undefined, affectsImage);
    assert.equal(t.rt.run.pageArrayEpoch, 1);
    assert.equal(t.resources(), 1);
  }
});
