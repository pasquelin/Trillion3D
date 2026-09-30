// #991: `shadowPcf` of the shipped WGSL, run through `shaderRun` with its page reads spied: every
// comparison and sample of a pixel takes the one `reference` it was handed; a neighbour page
// readable in the home page's range is read across the seam, one that is not at the home page's
// nearest texel — beside each edge and at the corner —, and without `taps` nothing is compared.
// Its taps turned by a jitter phase's angle (#1363), every tap still keeps to the pages the edge test
// names (`PCF_EDGE_TEXELS`), and unturned it is what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNumber as clamp } from '../../../../sdk-core/src/world/math/spherical.ts';
import { PCF_EDGE_TEXELS } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { hash } from './shadowPages.fixture.ts';
import { SHADOW_SUBTEXELS } from './shadowSampleWgsl.ts';
import { CONSTANTS, SHADOW_WGSL } from './sunRangeRead.fixture.ts';
import { POISSON_16 } from './shadowWgsl.ts';

type V = number[];
type Pcf = (...args: [object, V, number, V, number, number, boolean]) => number;
const { SHADOW_PAGE: PAGE, SHADOW_SUBTEXEL: SUBTEXEL, PCF_TAPS } = CONSTANTS;
const TEXELS = 4096;
/** Where the pool placed page `p`, as `shadowOffset` answers: `xy` to add to a texel, the layer. */
const placed = ([x, y]: V) => [
  Math.floor(hash(x * 7 + y * 131) * 32) * PAGE - x * PAGE,
  Math.floor(hash(x * 13 - y * 71) * 32) * PAGE - y * PAGE,
  Math.floor(hash(x - y * 3) * 4),
];
/** A comparison's answer, from all it was handed. */
const lit = (...args: unknown[]) =>
  hash(
    Math.floor((args.flat(2) as number[]).reduce((sum, x, i) => sum + x * (i + 1.618), 0) * 4096),
  );

type Calls = { neighbour: V[]; compare: unknown[][]; sample: unknown[][]; through: unknown[][] };
const spy = (): Calls => ({ neighbour: [], compare: [], sample: [], through: [] });
/** What a run reads and records: `readable(p)` tells whether neighbour `p` is readable in the
 *  home page's range. Swapped per pixel; the shader text compiles once. */
const live = { readable: (_: V) => false, calls: spy() };
/** The taps' turn, cosine and sine (\`shadowRotation\`): set in place per pixel. */
const TURN = [1, 0];
const turned = ([x, y]: V) => [x * TURN[0] - y * TURN[1], x * TURN[1] + y * TURN[0]];
/** The shipped `shadowPcf`, its page reads spied. */
const { shadowPcf } = shaderRun<{ shadowPcf: Pcf }>(
  SHADOW_WGSL,
  ['shadowPcf', 'shadowPcfEdge', 'shadowPcfStep', 'shadowRotated'],
  {
    ...CONSTANTS,
    shadowRotation: TURN,
    POISSON: POISSON_16,
    POISSON_STEPS: POISSON_16.map((tap) => tap.map((x) => x * SHADOW_SUBTEXELS)),
    shadowOffset: (_: number, p: V) => placed(p),
    shadowNeighbour: (_: object, p: V, home: V, __: number) => (
      live.calls.neighbour.push(p),
      live.readable(p) ? [...placed(p), 1] : [...home, 0]
    ),
    shadowCompare: (...args: unknown[]) => (live.calls.compare.push(args), lit(...args)),
    shadowSample: (...args: unknown[]) => (live.calls.sample.push(args), lit(...args)),
    shadowAtlasTexels: () => TEXELS,
    shadowThroughLit: (...args: unknown[]) => (
      live.calls.through.push(args),
      (args[4] as number) * 0.5
    ),
  },
);
/** `shadowPcf` with neighbours `readable`: its answer and the calls it made. */
function pcfRun(readable: (p: V) => boolean, ...args: Parameters<Pcf>) {
  Object.assign(live, { readable, calls: spy() });
  return { answer: shadowPcf(...args), calls: live.calls };
}

/** A texel coordinate in page `page`: near an edge, on one, or anywhere in it. */
function coordinate(r: () => number, page: number) {
  const pick = r(),
    within =
      pick < 0.35
        ? r() * 2
        : pick < 0.7
          ? PAGE - r() * 2
          : pick < 0.8
            ? [0, PCF_EDGE_TEXELS, 64, PAGE - PCF_EDGE_TEXELS][Math.floor(r() * 4)]
            : r() * PAGE;
  return page * PAGE + within;
}

/** What `shadowPcf` compares and returns at `t`, `readable` its neighbours' flags. */
function expected(t: V, home: V, side: number, reference: number, readable: (p: V) => boolean) {
  const first = home.map((p) => p * PAGE),
    edge = [0, 1].map(
      (a) => t[a] - PCF_EDGE_TEXELS < first[a] || t[a] + PCF_EDGE_TEXELS >= first[a] + PAGE,
    ),
    up = [0, 1].map((a) => t[a] - first[a] >= 0.5 * PAGE),
    step = up.map((u) => (u ? 1 : -1)),
    offset = placed(home);
  const neighbour = (p: V) => (readable(p) ? [...placed(p), 1] : [...offset, 0]);
  const pages = [
    edge[0] && [home[0] + step[0], home[1]],
    edge[1] && [home[0], home[1] + step[1]],
    edge[0] && edge[1] && [home[0] + step[0], home[1] + step[1]],
  ];
  const [nx, ny, nd] = pages.map((p) => (p ? neighbour(p) : [...offset, 0]));
  const compare: unknown[][] = [],
    sample: unknown[][] = [];
  let total = 0;
  for (const tap of POISSON_16.slice(0, PCF_TAPS).map(turned)) {
    if (!edge[0] && !edge[1]) {
      // Away from every edge a tap's bilinear footprint, turned any way, keeps to the home page.
      for (const a of [0, 1])
        assert.ok(t[a] + tap[a] - 0.5 >= first[a] && t[a] + tap[a] + 0.5 <= first[a] + PAGE);
      const at = [0, 1].map(
        (a) =>
          offset[a] +
          Math.floor(t[a] * SHADOW_SUBTEXELS + tap[a] * SHADOW_SUBTEXELS + 0.5) * SUBTEXEL,
      );
      sample.push([at, offset[2], TEXELS, reference]);
      total += lit(...sample.at(-1)!);
      continue;
    }
    const at = [0, 1].map((a) =>
        side > 0 ? clamp(t[a] + tap[a], 0.5, side - 0.5) : t[a] + tap[a],
      ),
      seam = [0, 1].map((a) => first[a] + (up[a] ? PAGE : 0)),
      h = [0, 1].map((a) => clamp(at[a], first[a] + 0.5, first[a] + PAGE - 0.5)),
      n = [0, 1].map((a) =>
        up[a] ? Math.max(at[a], seam[a] + 0.5) : Math.min(at[a], seam[a] - 0.5),
      ),
      w = [0, 1].map((a) => clamp(0.5 + (seam[a] - at[a]) * (up[a] ? 1 : -1), 0, 1));
    const read = (weight: number, page: V, texel: V) => {
      compare.push([page.slice(0, 3), texel, reference]);
      return weight * lit(...compare.at(-1)!);
    };
    let sum = read(w[0] * w[1], offset, h);
    if (edge[0]) sum += read((1 - w[0]) * w[1], nx, [nx[3] > 0 ? n[0] : h[0], h[1]]);
    if (edge[1]) sum += read(w[0] * (1 - w[1]), ny, [h[0], ny[3] > 0 ? n[1] : h[1]]);
    if (edge[0] && edge[1]) sum += read((1 - w[0]) * (1 - w[1]), nd, nd[3] > 0 ? n : h);
    total += sum;
  }
  return {
    neighbour: pages.filter(Boolean),
    compare,
    sample,
    through: [[offset, first, t, reference, total / PCF_TAPS]],
  };
}

test('shadowPcf compares every tap at its one reference, a neighbour across the seam only when readable (#991)', () => {
  const r = mulberry32(991),
    seen = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    const lamp = i % 2 === 0,
      pages = 1 + Math.floor(r() * 8),
      home = [0, 1].map(() => (lamp ? Math.floor(r() * pages) : Math.floor(r() * 17) - 8)),
      t = home.map((p) => coordinate(r, p)),
      side = lamp ? pages * PAGE : 0,
      reference = r() * 1.2 - 0.1,
      seed = Math.floor(r() * 2 ** 31),
      readable = (p: V) => hash(seed ^ Math.imul(p[0], 7919) ^ Math.imul(p[1], 104729)) < 0.5,
      angle = i % 4 < 2 ? 0 : r() * 2 * Math.PI;
    TURN.splice(0, 2, Math.cos(angle), Math.sin(angle));
    const want = expected(t, home, side, reference, readable),
      { answer, calls } = pcfRun(readable, {}, t, reference, home, 0x80000000, side, true);
    // Every argument, the one `reference` of each comparison and sample among them.
    assert.deepEqual(calls, want, `t ${t}, home ${home}, side ${side}`);
    assert.equal(answer, (want.through[0][4] as number) * 0.5);
    for (const p of calls.neighbour)
      seen.add(`${p[0] !== home[0]}${p[1] !== home[1]}${readable(p)}`);
    if (!calls.neighbour.length) seen.add('inside');
    if (lamp && t.some((x) => x < 2 || x > side - 2)) seen.add('lamp edge');

    // Without taps: the same pages asked for, nothing compared, no light.
    const dark = pcfRun(readable, {}, t, reference, home, 0x80000000, side, false);
    assert.equal(dark.answer, 0);
    assert.deepEqual(dark.calls, {
      neighbour: want.neighbour,
      compare: [],
      sample: [],
      through: [],
    });
  }
  // Each axis and the corner, readable or not; pixels away from every edge; a lamp face's border.
  assert.equal(seen.size, 8, [...seen].join(' '));
});
