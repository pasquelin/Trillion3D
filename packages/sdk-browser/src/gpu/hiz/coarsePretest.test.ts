import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_KERNEL_TEXELS } from '../../hiz/counts.ts';
import { packHizPyramid, type PackedHiz } from './oracle.ts';
import { HIZ_HIDDEN_WGSL, HIZ_HIDES_WGSL, HIZ_LEVEL_WGSL } from './rectWgsl.ts';
import { HIZ_SHADER } from './shader.ts';
import { PARTITION_CLASSIFY_WGSL } from '../partition/classifyWgsl.ts';
import { SHADOW_OCCLUSION_SHADER } from '../shadow/occlusionShader.ts';

// The Hi-Z rectangle test reads a coarse mip first and stops at the first texel that does not
// hide (`pyramidHides`), where it used to take the minimum of the whole footprint
// (`pyramidFar`). Below, both WGSL functions transcribed line by line, in f32, must return the
// same verdict on random pyramids, rectangles, depths and biases, and on the hostile values:
// NaN, ±0, ±Inf, a one-texel pyramid, a footprint as wide as the kernel, a mip table cut short.

const f32 = Math.fround;
const KERNEL = HIZ_KERNEL_TEXELS;

/** `firstLevel` then `hizLevelFor`: the mip that covers the rectangle, or -1. */
function levelFor(x0: number, y0: number, x1: number, y1: number, levels: number) {
  const span = Math.max(x1 - x0, y1 - y0);
  let l = span < KERNEL ? 0 : 31 - Math.clz32(span) - (Math.log2(KERNEL) - 1);
  for (; l < levels; l++)
    if ((x1 >> l) - (x0 >> l) < KERNEL && (y1 >> l) - (y0 >> l) < KERNEL) return l;
  return -1;
}

/** `hizCoarseLevel`. */
function coarseLevel(x0: number, y0: number, x1: number, y1: number, l: number, levels: number) {
  let c = l;
  while (c + 1 < levels && !((x1 >> c) - (x0 >> c) < 2 && (y1 >> c) - (y0 >> c) < 2)) c++;
  return c;
}

/** The old read: the minimum of the footprint (`pyramidFar`), WGSL `min` taken as `Math.min`.
 *  A NaN TEXEL is equivalent only under this NaN-propagating `min`: WGSL leaves `min` with a NaN
 *  operand indeterminate, and where it returns the other operand the old read could reject what
 *  `texelsHide` keeps. A pyramid reduced from a depth texture holds no NaN. */
function footprintFar(p: PackedHiz, l: number, x0: number, y0: number, x1: number, y1: number) {
  let far = f32(1.0e30);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      far = Math.min(far, p.data[p.offsets[l] + y * p.sizes[l][0] + x]);
  return far;
}

/** `texelsHide`, with its early exit, counting the texels it reads. */
function texelsHide(p: PackedHiz, l: number, rect: number[], nearest: number, bias: number) {
  const [x0, y0, x1, y1] = rect;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (!(nearest < f32(p.data[p.offsets[l] + y * p.sizes[l][0] + x] - bias))) return false;
  return true;
}

type Verdicts = { before: boolean; after: boolean; shift: number };

/** One clipped rectangle judged the old way and the new way, as `hiddenByPyramid` and the
 *  partition's packing then `testHiz` do. */
function judge(p: PackedHiz, rect: number[], levels: number, nearest: number, bias: number) {
  const [x0, y0, x1, y1] = rect;
  const l = levelFor(x0, y0, x1, y1, levels);
  if (l < 0) return undefined;
  const fine = rect.map((v) => v >> l);
  assert.ok(fine[2] + 1 - fine[0] <= KERNEL && fine[3] + 1 - fine[1] <= KERNEL);
  const before = nearest < f32(footprintFar(p, l, fine[0], fine[1], fine[2], fine[3]) - bias);
  const c = coarseLevel(x0, y0, x1, y1, l, levels),
    shift = c - l;
  const coarse = fine.map((v) => v >> shift);
  assert.deepEqual(
    coarse,
    rect.map((v) => v >> c),
    'the coarse footprint is the rectangle at c',
  );
  assert.ok(
    (coarse[2] - coarse[0] <= 1 && coarse[3] - coarse[1] <= 1) || c === levels - 1,
    'at most 2×2 texels, or the last mip',
  );
  const after =
    (shift > 0 && texelsHide(p, c, coarse, nearest, bias)) || texelsHide(p, l, fine, nearest, bias);
  return { before, after, shift } satisfies Verdicts;
}

function lcg(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) as number;
}

const SPECIALS = [0, -0, 1, Infinity, -Infinity, Number.NaN, f32(0.5), f32(1e-30)];

function pyramid(rand: () => number, width: number, height: number, hostile: boolean) {
  // A few distinct depths so that ties between the box and the texels are frequent.
  const palette = Array.from({ length: 6 }, () => f32(rand()));
  const pick = () =>
    hostile && rand() < 0.05
      ? SPECIALS[Math.floor(rand() * SPECIALS.length)]
      : palette[Math.floor(rand() * palette.length)];
  return packHizPyramid(Array.from({ length: height }, () => Array.from({ length: width }, pick)));
}

function sweep(seed: number, hostile: boolean) {
  const rand = lcg(seed);
  let judged = 0,
    rejected = 0,
    coarse = 0;
  for (let trial = 0; trial < 400; trial++) {
    const width = 1 + Math.floor(rand() * 90),
      height = 1 + Math.floor(rand() * 90);
    const p = pyramid(rand, width, height, hostile);
    // A mip table cut short (the camera's holds at most 16) leaves wide rectangles unjudged.
    const levels = rand() < 0.2 ? 1 + Math.floor(rand() * p.sizes.length) : p.sizes.length;
    for (let box = 0; box < 40; box++) {
      const x0 = Math.floor(rand() * width),
        y0 = Math.floor(rand() * height);
      const x1 = x0 + Math.floor(rand() * (width - x0)),
        y1 = y0 + Math.floor(rand() * (height - y0));
      const nearest =
        hostile && rand() < 0.1
          ? SPECIALS[Math.floor(rand() * SPECIALS.length)]
          : f32(p.data[Math.floor(rand() * p.data.length)] - (rand() - 0.5) * 0.1);
      const bias = rand() < 0.5 ? 0 : f32(rand() * 0.05);
      const verdicts = judge(p, [x0, y0, x1, y1], levels, nearest, bias);
      if (!verdicts) continue;
      judged++;
      if (verdicts.before) rejected++;
      if (verdicts.shift > 0) coarse++;
      assert.equal(verdicts.after, verdicts.before, `seed ${seed}, [${x0},${y0},${x1},${y1}]`);
    }
  }
  return { judged, rejected, coarse };
}

test('the coarse pre-test and early exit give the verdict of the whole-footprint minimum', () => {
  for (const seed of [1, 2, 3, 4]) {
    const { judged, rejected, coarse } = sweep(seed, false);
    // The sweep reaches both verdicts and the coarse path, else it proves nothing.
    assert.ok(rejected > 0 && rejected < judged && coarse > 0);
  }
});

test('same verdict with NaN, ±0 and ±Inf in the pyramid and as the box depth', () => {
  for (const seed of [11, 12, 13, 14]) sweep(seed, true);
});

test('edge cases: one texel, a kernel-wide footprint, a buried box, a box in front', () => {
  const one = packHizPyramid([[0.5]]);
  for (const nearest of [0.25, 0.5, 0.75, -0, Number.NaN, -Infinity])
    assert.deepEqual(judge(one, [0, 0, 0, 0], 1, nearest, 0), {
      before: nearest < 0.5,
      after: nearest < 0.5,
      shift: 0,
    });
  const wide = packHizPyramid(Array.from({ length: 64 }, () => new Array<number>(64).fill(0.5)));
  const full = [0, 0, 63, 63];
  const buried = judge(wide, full, wide.sizes.length, 0.25, 0);
  assert.deepEqual(buried, { before: true, after: true, shift: 3 });
  assert.deepEqual(judge(wide, full, wide.sizes.length, 0.75, 0), {
    before: false,
    after: false,
    shift: 3,
  });
  // The kernel-wide footprint at level 0 exactly.
  const edge = [0, 0, KERNEL - 1, KERNEL - 1];
  assert.equal(levelFor(edge[0], edge[1], edge[2], edge[3], wide.sizes.length), 0);
  assert.equal(judge(wide, edge, wide.sizes.length, 0.25, 0)?.after, true);
  // No mip covers the rectangle: unjudged on both sides.
  assert.equal(judge(wide, full, 2, 0.25, 0), undefined);
});

test('the three Hi-Z tests read through the coarse pre-test, and no whole-footprint walk is left', () => {
  assert.match(HIZ_LEVEL_WGSL, /fn hizCoarseLevel\(rect:vec4i,l:u32,levels:u32\)->u32\{/);
  assert.match(
    HIZ_HIDES_WGSL,
    /if\(!\(nearest<pyramid\[offset\+u32\(y\)\*width\+u32\(x\)\]-bias\)\)\{return false;\}/,
  );
  for (const shader of [HIZ_HIDDEN_WGSL, HIZ_SHADER, SHADOW_OCCLUSION_SHADER])
    assert.match(shader, /pyramidHides\(/);
  for (const shader of [
    HIZ_HIDDEN_WGSL,
    HIZ_SHADER,
    SHADOW_OCCLUSION_SHADER,
    PARTITION_CLASSIFY_WGSL,
  ])
    assert.doesNotMatch(shader, /pyramidFar/);
  assert.match(HIZ_HIDDEN_WGSL, /let c=hizCoarseLevel\(vec4i\(x0,y0,x1,y1\),l,uni\.levels\);/);
  assert.match(SHADOW_OCCLUSION_SHADER, /let c=hizCoarseLevel\(rect,l,/);
  // The partition packs the coarse mip into the three words `testHiz` reads it from.
  assert.match(
    PARTITION_CLASSIFY_WGSL,
    /let coarse=hizCoarseLevel\(vec4i\(x0,y0,x1,y1\),level,uni\.levels\);/,
  );
  assert.match(PARTITION_CLASSIFY_WGSL, /tested\[slot\+11u\]=coarse-level;/);
  assert.match(HIZ_SHADER, /triangles:u32,coarseOffset:u32,coarseWidth:u32,coarseShift:u32,\}/);
  assert.match(HIZ_SHADER, /b\.coarseOffset,b\.coarseWidth,b\.coarseShift\)/);
});
