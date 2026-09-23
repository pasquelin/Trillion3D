import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
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
import { describePageSlots, pageAddress } from './webgpuPageSlots.ts';

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

// Index pages are content-addressed: two clusters whose index bytes are identical are published
// under one url, while the compiler writes each of them its own quantized page. The pool is
// addressed by that page, so each takes a slot of its own and decodes its own geometry — one slot
// for the two would have made one of them draw the other's triangle.
test('two clusters sharing an index page each keep their own page and draw', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  // The same corner list twice, so the two index pages hold the same bytes; the second cluster
  // carries a texture coordinate, so the two quantized pages do not.
  const fixture = pagedQuad([
    { corners: FIRST },
    { corners: FIRST, attributes: { TEXCOORD_0: { itemSize: 2, array: WIDE.subarray(0, 8) } } },
  ]);
  const pages = fixture.metadata.primitives[0].pages;
  pages[1].url = pages[0].url;
  const { gpu, backend } = pagedQuadBackend(fixture, events);
  try {
    await backend.prepare();
    backend.render(frontCamera());
    await backend.flush?.();
    assert.equal(geometryPages(events).context.fromGeometryPage, 2, 'both draw from their page');
    assert.equal(backend.metrics().submittedTriangles, 2, 'both clusters are drawn');
    const pool = gpu.buffers.find((buffer) => buffer.label === 'WG geometry page cache')!;
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
    const width = Number(geometryPages(events).context.slotBytes);
    const held = Array.from({ length: pool.data.byteLength / width }, (_, at) =>
      hex(pool.data.subarray(at * width, (at + 1) * width)),
    );
    // Each page opens a slot of its own: under one address, one of the two would be missing.
    const at = fixture.encoded.map((page) => held.findIndex((s) => s.startsWith(hex(page.data))));
    assert.ok(
      at.every((slot) => slot >= 0),
      'both pages are in the pool',
    );
    assert.notEqual(at[0], at[1], 'each page holds a slot of its own');
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
// cluster url, and only the opaque one carries a geometry page: transparency is a property of the
// placement, the page a property of the cluster. Their pool addresses differ, so the copy is served
// the index words its forward draw reads while the opaque record keeps its quantized page.
test('a blend placement reads index words where the opaque one keeps its page', () => {
  const opaque = slotRecord({ geometryPage: descriptor('page/0.wgp') }),
    blend = slotRecord({ transparent: true });
  assert.notEqual(pageAddress(opaque), pageAddress(blend), 'two addresses, therefore two slots');
  const slots = describePageSlots([opaque, blend]);
  assert.equal(opaque.geometryPage?.url, 'page/0.wgp', 'the opaque record gives nothing up');
  assert.deepEqual([...slots.geometryUrls], [['page/0.wgp', 'page/0.wgp']]);
  assert.equal(slots.geometryUrls.get('cluster/0'), undefined, 'the copy slot holds index words');
  assert.equal(slots.transparentClusters, 1, 'the copy is counted transparent');
  assert.equal(slots.fromGeometryPage, 1);
  assert.equal(slots.fromSourceGeometry, 0);
});
