// #709 left every level of a masked chain unwritten — alpha 0 — and every leaf cut; #748 keeps each
// level's coverage at level 0's, and #769 WebGL2's. Without a browser: each backend's shipped
// reduction (`reducedAlpha`) and pick run on the CPU (`shaderRule.fixture.ts`) over the whole chain
// of `leaves-cut-by-alpha`'s leaf, 256², cut at 0.5 (C = 128).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIP_SHADER } from './mips.ts';
import { COVERAGE_WGSL } from './coverageMips.ts';
import { COVERAGE_PICK_GLSL } from './coverageRule.ts';
import { MIP_FRAGMENT_GLSL } from '../webgl/cluster/mips.ts';
import { levelSize, mipLevelCountFor } from './tiles.ts';
import { shaderFunctions, vec } from './shaderRule.fixture.ts';
import { leafAlpha } from '../../../../tests/fixtures/leafTexture.ts';

const SIDE = 256,
  C = 128;
type Alpha = { x: number; y: number; z: number; w: number };
type Reduction = {
  median(a: Alpha): number;
  reducedAlpha(a: Alpha, c: number, t: number): number;
  pick(c: number, covered: number, texels: ReturnType<typeof vec>): number;
};

/** The chain a shader text builds from `level0`, as the GPU runs it (`generateMaterialMips`): per
 *  level, the four taps of the level above clamped at its edge, the count's histogram of their
 *  medians and its `t`, then each texel's `reducedAlpha` stored as a byte. */
function chainOf(shader: string, cutoff: number) {
  let histogram: number[] = [];
  const names = ['toByte', 'median', 'scaled', 'reducedAlpha', 'wide', 'below', 'apart', 'pick'];
  const run = shaderFunctions<Reduction>(shader, names, { binOf: (t: number) => histogram[t] });
  const levels: Array<Uint8Array | null> = [leafAlpha(SIDE)];
  const covered = levels[0]!.filter((a) => a >= C).length;
  for (let level = 1; level < mipLevelCountFor(SIDE, SIDE); level++) {
    const [sw, sh] = levelSize(SIDE, SIDE, level - 1),
      [w, h] = levelSize(SIDE, SIDE, level);
    const above = levels[level - 1]!,
      tap = (x: number, y: number) => above[Math.min(y, sh - 1) * sw + Math.min(x, sw - 1)] / 255;
    const taps = Array.from({ length: w * h }, (_, i) => {
      const [x, y] = [(i % w) * 2, Math.floor(i / w) * 2];
      return { x: tap(x, y), y: tap(x + 1, y), z: tap(x, y + 1), w: tap(x + 1, y + 1) };
    });
    histogram = Array<number>(256).fill(0);
    for (const a of taps) histogram[run.median(a)]++;
    const t = cutoff && run.pick(cutoff, covered, vec(SIDE * SIDE, w * h));
    levels.push(Uint8Array.from(taps, (a) => Math.round(run.reducedAlpha(a, cutoff, t) * 255)));
  }
  return levels;
}

/** Every level written, never all transparent, its texels at or above C level 0's share within
 *  2.5 % or one texel — a level cannot hold a fraction of one. */
function holdsCoverage(levels: Array<Uint8Array | null>) {
  const share = levels[0]!.filter((a) => a >= C).length / levels[0]!.length;
  levels.forEach((alpha, level) => {
    assert.ok(alpha, `level ${level} written`);
    assert.ok(
      alpha.some((a) => a > 0),
      `level ${level} is not all transparent`,
    );
    const kept = alpha.filter((a) => a >= C).length,
      target = share * alpha.length;
    const tolerance = Math.max(0.025 * target, 1);
    assert.ok(Math.abs(kept - target) <= tolerance, `level ${level}: ${kept} kept, ${target} due`);
  });
}

/** Each backend's reduction and pick as shipped, what it stores, and its scale's last line. */
const BACKENDS = {
  WebGPU: {
    shipped: MIP_SHADER + COVERAGE_WGSL,
    stored: 'reducedAlpha(a,extent.z,extent.w))',
    scale: 'return f32(scaled(median(a),c,t))/255.0;',
  },
  WebGL2: {
    shipped: MIP_FRAGMENT_GLSL + COVERAGE_PICK_GLSL,
    stored: 'reducedAlpha(a,cutoff,t));',
    scale: 'return float(scaled(median(a),c,t))/255.;',
  },
};

for (const [backend, { shipped, stored, scale }] of Object.entries(BACKENDS)) {
  test(`the shipped ${backend} reduction keeps the leaf’s coverage at every level of its chain`, () => {
    assert.ok(shipped.includes(stored), 'the texel it stores');
    holdsCoverage(chainOf(shipped, C));
  });

  test(`${backend}: a chain left unwritten, zeroed, thinned or grown by the median is refused`, () => {
    const unwritten = chainOf(shipped, C).map((alpha, level) => (level ? null : alpha));
    assert.throws(() => holdsCoverage(unwritten), /level 1 written/);
    const zeroed = chainOf(shipped, C).map((alpha, level) => (level ? alpha!.fill(0) : alpha));
    assert.throws(() => holdsCoverage(zeroed), /level 1 is not all transparent/);
    const broken = shipped.replace(scale, 'return 0.0;');
    assert.notEqual(broken, shipped);
    assert.throws(() => holdsCoverage(chainOf(broken, C)), /level 1 is not all transparent/);
    // The median alone — develop's chain before #748 — grows this leaf to 12 of 16 texels at 4².
    assert.throws(() => holdsCoverage(chainOf(shipped, 0)), /level 6: 12 kept/);
  });
}
