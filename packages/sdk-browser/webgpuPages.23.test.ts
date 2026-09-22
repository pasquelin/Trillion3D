import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { frontCamera } from './pagesBackendScenes.ts';
import { CLUSTER_PAGE_MAGIC } from './clusterFormat.ts';
import {
  disposePagedQuad,
  pagedQuad,
  pagedQuadBackend,
  FIRST,
  SECOND,
} from './pagedQuadFixture.ts';
import type { BackendDiagnostic } from './backendTypes.ts';
import type { PageRec } from './pageSelection.ts';
import { describePageSlots } from './webgpuPageSlots.ts';

/** The quad as two clusters whose two widths disagree: the first draws both triangles from
 *  positions alone — six corners in the fewest bytes the format can hold them — while the second
 *  draws one triangle but carries a normal, a texture coordinate and a colour, which makes its
 *  page the widest of the scene in BYTES while it is the narrowest in CORNERS. */
const WIDE = new Float32Array([0, 0, 1, 0.5, 0.5, 0.7, 1, 0, 0, 0.2, 0.9, 0.4, 0.3, 0.8, 0.1, 0.6]);
const lopsided = () =>
  pagedQuad([
    { corners: new Uint32Array([...FIRST, ...SECOND]) },
    {
      corners: SECOND,
      attributes: {
        NORMAL: { itemSize: 3, array: WIDE.subarray(0, 12) },
        TEXCOORD_0: { itemSize: 2, array: WIDE.subarray(0, 8) },
        COLOR_0: { itemSize: 4, array: WIDE },
      },
    },
  ]);

const geometryPages = (events: BackendDiagnostic[]) =>
  events.find((event) => event.phase === 'geometry-pages')!;

// A pool slot is as wide as the widest page in BYTES; a draw is as long as the widest cluster in
// CORNERS. Under twelve packed bytes per triangle the two are unrelated, so a ceiling read off the
// slot would cut the tail triangles of exactly the clusters the format compresses best.
test('the draw ceiling is the catalogue largest corner count, not the slot width', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  const fixture = lopsided();
  const { backend } = pagedQuadBackend(fixture, events);
  try {
    await backend.prepare();
    const corners = fixture.encoded.map((page) => page.indexCount),
      bytes = fixture.encoded.map((page) => page.data.byteLength);
    // The fixture is only worth something while the two widest are not the same page.
    assert.equal(corners.indexOf(Math.max(...corners)), 0);
    assert.equal(bytes.indexOf(Math.max(...bytes)), 1);
    const declared = geometryPages(events).context;
    const ceiling = Number(declared.drawCorners),
      slotWords = Number(declared.slotBytes) / 4;
    assert.equal(ceiling, Math.max(...corners), 'the ceiling is the largest corner count');
    for (const count of corners) assert.ok(ceiling >= count, 'every corner is still drawn');
    assert.notEqual(ceiling, slotWords, 'the ceiling no longer follows the slot width');
  } finally {
    await disposePagedQuad(backend, fixture);
  }
});

// Page words go into the pool unread and are decoded in place by the shaders, so a forged page
// would never be noticed downstream. The format's own gate runs at admission instead.
test('a page whose header is forged is refused instead of poured into the pool', async () => {
  installGpuGlobals();
  const forgeries: Record<string, (view: DataView) => void> = {
    magic: (view) => view.setUint32(0, CLUSTER_PAGE_MAGIC ^ 1, true),
    version: (view) => view.setUint32(4, 9, true),
    counts: (view) => view.setUint32(8, view.getUint32(8, true) + 16, true),
  };
  for (const forge of Object.values(forgeries)) {
    const fixture = pagedQuad([{ corners: FIRST }, { corners: SECOND }]);
    const { backend } = pagedQuadBackend(fixture, [], async (url: string) => {
      const bytes = fixture.bytes.get(url)!.slice();
      forge(new DataView(bytes.buffer));
      return bytes;
    });
    try {
      await assert.rejects(backend.prepare(), /GEOMETRY_PAGE_/);
    } finally {
      await disposePagedQuad(backend, fixture);
    }
  }
});

// A cluster drawn from its quantized page needs nothing of its index page: the corner count the
// row writes is the one the geometry page declares, so the index page is never fetched and never
// held on the CPU.
test('a paged cluster is admitted and drawn without its index page', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  const fixture = pagedQuad([{ corners: FIRST }, { corners: SECOND }]);
  // No index array, and no reader that could go and get one: only the page reader answers.
  const { gpu, backend } = pagedQuadBackend({ ...fixture, indices: new Map() }, events);
  try {
    await backend.prepare();
    backend.render(frontCamera());
    await backend.flush?.();
    assert.equal(geometryPages(events).context.fromGeometryPage, 2);
    assert.deepEqual(backend.pendingUrls?.(), [], 'nothing is awaited any more');
    const pool = gpu.buffers.find((buffer) => buffer.label === 'WG geometry page cache')!;
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
    const slot = Number(geometryPages(events).context.slotBytes);
    const held = fixture.encoded.map((page, at) =>
      hex(pool.data.subarray(at * slot, at * slot + page.data.byteLength)),
    );
    assert.deepEqual(held.sort(), fixture.encoded.map((page) => hex(page.data)).sort());
  } finally {
    await disposePagedQuad(backend, fixture);
  }
});

/** A quantized page of the shape the manifest declares, at an address of its own. */
const descriptor = (url: string) => ({
  url,
  sha256: '',
  bytes: 64,
  vertexCount: 3,
  indexCount: 3,
  flags: 0,
  uncompressedBytes: 128,
});
/** A catalogue record reduced to what a pool slot is decided from. */
const slotRecord = (extra: Partial<PageRec>) =>
  ({ url: 'cluster/0', triangles: 1, indexBytes: 12, ...extra }) as unknown as PageRec;

// One primitive placed twice — opaque here, `clustered-blend` there — gives two records at one
// cluster address, and only the opaque placement carries a geometry page. That catalogue is sound:
// the pool holds ONE slot per address and the transparent draw reads index words out of it, so the
// address keeps its index page for both placements instead of being refused.
test('an address a blend placement shares with an opaque one keeps its index page', () => {
  const opaque = slotRecord({ geometryPage: descriptor('page/0.wgp') }),
    blend = slotRecord({ transparent: true });
  const slots = describePageSlots([opaque, blend]);
  assert.equal(slots.sharedIndexPages, 1, 'the shared address gave its page up');
  assert.equal(slots.geometryUrls.size, 0, 'the one slot holds index words');
  assert.equal(opaque.geometryPage, undefined, 'the row reads the decision the slot was made on');
  assert.equal(slots.transparentClusters, 1, 'the copy is counted transparent');
  assert.equal(slots.fromSourceGeometry, 1);
  assert.equal(slots.fromGeometryPage, 0);
});

// Two placements of the same kind cannot explain a disagreement: one row would decode index words
// as a page, or a page as index words, and no reading of the catalogue says which. Refused.
test('two opaque records that disagree on a cluster page are still refused', () => {
  const paged = slotRecord({ geometryPage: descriptor('page/0.wgp') }),
    plain = slotRecord({});
  assert.throws(() => describePageSlots([paged, plain]), /CLUSTER_PAGE_DISAGREEMENT/);
  assert.throws(
    () => describePageSlots([paged, slotRecord({ geometryPage: descriptor('page/1.wgp') })]),
    /CLUSTER_PAGE_DISAGREEMENT/,
  );
});
