// The pool's texels page by page (`vsmPoolTexelIndexWgsl`), by its TS mirror: every texel of a
// slice has a word of its own, page k filling [k·16384, (k+1)·16384), at 128 pages a row;
// each texel stays in the binding part its page row was in; and both WGSL accessors — the passes'
// (`vsmBindingsWgsl`) and the consumers' (`directShadowWgsl`, the shift from the uniform) — give
// the mirror's words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { vsmBindingsWgsl } from './resources.ts';
import { directShadowWgsl } from '../lighting/direct/shadowWgsl.ts';
import { VSM_LOG2_PAGE, VSM_PAGE_TEXELS } from './constants.ts';
import { vsmLayout, type VsmLayout } from './layout.ts';

/** The TS mirror of `vsmPoolTexelIndexWgsl`. */
function vsmPoolTexelIndex(layout: VsmLayout, x: number, y: number) {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1;
  const page = ((y >>> L) << layout.poolRowShift) | (x >>> L);
  return ((page << (2 * L)) | ((y & M) << L) | (x & M)) >>> 0;
}

const PAGE_WORDS = VSM_PAGE_TEXELS * VSM_PAGE_TEXELS;
/** Layouts of 128 pages a row, 4 and 8 rows; the last split in parts of two page rows. */
const LAYOUTS = [
  vsmLayout({ fullMapCapacity: 7, poolPages: 512 }, 2 ** 27),
  vsmLayout({ fullMapCapacity: 7, poolPages: 1024 }, 2 ** 27),
  vsmLayout({ fullMapCapacity: 7, poolPages: 1024 }, 2 * 128 * PAGE_WORDS * 4),
];

test('every texel of a slice has a word of its own, page k filling [k·16384, (k+1)·16384)', () => {
  assert.deepEqual(
    LAYOUTS.map((l) => [l.poolPagesXY[0], l.poolPartsPerSlice]),
    [
      [128, 1],
      [128, 1],
      [128, 4],
    ],
  );
  for (const layout of LAYOUTS.slice(0, 2)) {
    const [width, height] = layout.poolTexelsXY,
      seen = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const word = vsmPoolTexelIndex(layout, x, y),
          page = (y >> 7) * layout.poolPagesXY[0] + (x >> 7);
        assert.ok(word >= page * PAGE_WORDS && word < (page + 1) * PAGE_WORDS, `(${x}, ${y})`);
        assert.equal(seen[word]++, 0, `(${x}, ${y}) shares word ${word}`);
      }
    assert.ok(seen.every((n) => n === 1));
  }
});

test('a texel stays in the binding part its page row was in', () => {
  for (const layout of LAYOUTS) {
    const width = layout.poolTexelsXY[0],
      shift = layout.poolPartTexelShift;
    for (let y = 0; y < layout.poolTexelsXY[1]; y += 3)
      for (let x = 0; x < width; x += 5) {
        const rowByRow = y * width + x;
        assert.equal(vsmPoolTexelIndex(layout, x, y) >>> shift, rowByRow >>> shift, `(${x}, ${y})`);
      }
  }
});

test('the passes and the consumers address the pool by the mirror', () => {
  // The consumers' read as the passes that bind the pool (the blend, the water) compose it.
  const consumer = directShadowWgsl(null, 20);
  for (const layout of LAYOUTS) {
    const specs = [{ resource: 'pagePool', binding: 0, access: 'read_write' }] as const;
    const passes = vsmBindingsWgsl(0, specs, layout);
    // Both accessors take the part from the word, as before, and the word from the one helper.
    for (const accessor of ['vsmPoolLoad', 'vsmPoolStore'])
      assert.match(
        functionText(passes, accessor),
        new RegExp(`let l=vsmPoolTexelIndex\\(t\\);[^]*>>${layout.poolPartTexelShift}u\\)`),
      );
    assert.match(functionText(consumer, 'vsmPoolLoad'), /let i=vsmPoolTexelIndex\(t\);/);
    type Run = { vsmPoolTexelIndex: (t: number[]) => number };
    const run = (code: string) =>
      shaderRun<Run>(code, ['vsmPoolTexelIndex'], {
        vsm: { poolRowShift: layout.poolRowShift },
      }).vsmPoolTexelIndex;
    const own = run(passes),
      read = run(consumer);
    const [width, height] = layout.poolTexelsXY;
    for (let k = 0; k < 20000; k++) {
      const x = k < 4 ? [0, 127, 128, width - 1][k] : (k * 7919) % width,
        y = k < 4 ? [0, 127, 128, height - 1][k] : (k * 104729) % height,
        word = vsmPoolTexelIndex(layout, x, y);
      assert.equal(own([x, y]), word, `(${x}, ${y})`);
      assert.equal(read([x, y]), word, `(${x}, ${y})`);
    }
  }
});
