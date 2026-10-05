// S19.2: the visibility raster's vertex stages hand their UV on only where the cutout reads it — a
// row with UVs that is masked —, never on every row with UVs. The shipped `vis_vs`, `vis_hiz_vs` and
// `maskKeep` are run on every combination of the flags the cutout reads: each fragment keeps the
// verdict it had when every row with UVs handed them on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../../texture/shaderRun.fixture.ts';
import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { FLAG_HAS_COLOR, FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_MASK, FLAG_SAMPLED } from '../types.ts';

type Vec = number[];
type Out = { tc: Vec };
type Run = {
  vis_vs: (vertex: number, instance: number) => Out;
  vis_hiz_vs: (vertex: number, instance: number) => Out;
  maskKeep: (page: object, uv: Vec, alpha: number, ddx: Vec, ddy: Vec) => boolean;
};
/** The UV a vertex reads, and its vertex alpha: off zero, so a stage that drops them shows. */
const UV = [0.8, 0.2],
  ALPHA = 0.6;
const BITS = [FLAG_HAS_UV, FLAG_MASK, FLAG_HAS_MAP, FLAG_HAS_COLOR, FLAG_SAMPLED];
/** The rows whose cutout reads a UV: with UVs, and masked. */
const READ = FLAG_HAS_UV | FLAG_MASK;
const IDENTITY = new Mat([...IDENTITY_MATRIX4]);

/** The page of flags `flags`, its threshold `cut`, dashed or not. */
const pageOf = (flags: number, cut: number, dashed: boolean) => ({
  flags,
  indexCount: 3,
  world: IDENTITY,
  lineWidth: 0,
  sprite: [0, 0],
  packedBase: 0,
  hizSlot: 0xffffffff,
  baseColor: [1, 1, 1, cut],
  blendCoverage: 1,
  dash: dashed ? [0.5, 0.5] : [0, 0],
  mapIndex: 0,
});

/** The shipped stages, translated once, over `pages[0]`; each UV read counted. */
const pages: object[] = [],
  reads = { uv: 0 };
const run = shaderRun<Run>(
  VIS_SHADER,
  ['vis_vs', 'vis_hiz_vs', 'hardwareIdle', 'maskKeep', 'lineDash'],
  {
    pages,
    hizFlags: [],
    uni: { viewProj: IDENTITY, computeSpan: 0 },
    drawBatch: () => [0, 0],
    pageHeaderFor: () => ({}),
    pageSurfaceRead: () => true,
    hardwareCorner: (_page: unknown, _h: unknown, vertex: number) => vertex,
    HARDWARE_SKIP: 0xffffffff,
    hizRejected: () => false,
    pagePosition: () => [0, 0, 0],
    pageUv: () => (reads.uv++, [...UV]),
    pageMaskAlpha: () => ALPHA,
    // The map's alpha is the UV's first coordinate: a cutout read at another UV answers otherwise.
    maskAlpha: (_map: number, uv: Vec) => uv[0],
  },
);

/** What the vertex handed on while every row with UVs did: the UV, then a masked row's alpha. */
function everyUv(flags: number): Vec {
  const tc = (flags & FLAG_HAS_UV) !== 0 ? [...UV, 0] : [0, 0, 0];
  if ((flags & FLAG_MASK) !== 0) tc[2] = ALPHA;
  return tc;
}

test('a vertex reads its UV only on a masked row with UVs, and every cutout verdict holds', () => {
  for (let set = 0; set < 1 << BITS.length; set++) {
    const flags = BITS.reduce((all, bit, i) => (set & (1 << i) ? all | bit : all), 0);
    for (const cut of [0, 0.5, 0.7])
      for (const dashed of [false, true]) {
        const page = (pages[0] = pageOf(flags, cut, dashed));
        const was = everyUv(flags),
          wasKept = run.maskKeep(page, was.slice(0, 2), was[2], [0, 0], [0, 0]);
        for (const stage of [run.vis_vs, run.vis_hiz_vs]) {
          reads.uv = 0;
          const { tc } = stage(0, 0);
          const where = `flags ${flags}, cut ${cut}, dashed ${dashed}`;
          assert.equal(reads.uv, (flags & READ) === READ ? 1 : 0, `UV read: ${where}`);
          assert.equal(tc[2], was[2], `vertex alpha: ${where}`);
          assert.equal(run.maskKeep(page, tc.slice(0, 2), tc[2], [0, 0], [0, 0]), wasKept, where);
        }
      }
  }
});

test('the cases above part: a masked row cuts at its UV, an unmasked one never reads it', () => {
  const masked = pageOf(FLAG_HAS_UV | FLAG_MASK | FLAG_HAS_MAP, 0.5, false);
  assert.equal(run.maskKeep(masked, UV, ALPHA, [0, 0], [0, 0]), true);
  assert.equal(run.maskKeep(masked, [0, 0], ALPHA, [0, 0], [0, 0]), false, 'the UV decides');
  const dashed = pageOf(FLAG_HAS_UV | FLAG_MASK, 0, true);
  assert.equal(run.maskKeep(dashed, UV, ALPHA, [0, 0], [0, 0]), false, 'a gap at 0.8');
  const plain = pageOf(FLAG_HAS_UV | FLAG_HAS_MAP, 0.5, true);
  assert.equal(run.maskKeep(plain, [Number.NaN, 0], 0, [0, 0], [0, 0]), true, 'no UV read');
});
