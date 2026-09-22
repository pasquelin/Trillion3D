import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import {
  disposePagedQuad,
  pagedQuad,
  pagedQuadBackend,
  FIRST,
  SECOND,
} from './pagedQuadFixture.ts';
import type { BackendDiagnostic } from './backendTypes.ts';

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
