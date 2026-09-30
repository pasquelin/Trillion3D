// `shadowPcf` of the shipped WGSL, run through `shaderRun` with its page reads spied (#991), and
// what it should compare and return, written from the page model: the runs `shadowPcfRun.test.ts`
// and `shadowPcfMoving.test.ts` check.
import assert from 'node:assert/strict';
import { clampNumber as clamp } from '../../../../sdk-core/src/world/math/spherical.ts';
import { PCF_EDGE_TEXELS } from '../../../../sdk-core/src/scene/light-shadow/pcfEdge.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { hash } from './shadowPages.fixture.ts';
import { SHADOW_SUBTEXELS } from './shadowSampleWgsl.ts';
import { CONSTANTS, SHADOW_WGSL } from './sunRangeRead.fixture.ts';
import { POISSON_16 } from './pcfTaps.ts';

export type V = number[];
type Pcf = (...args: [object, V, number, V, number, number, boolean]) => number;
export const { SHADOW_PAGE: PAGE, SHADOW_SUBTEXEL: SUBTEXEL, PCF_TAPS } = CONSTANTS;
const TEXELS = 4096;
/** Where the pool placed page `p`, as `shadowOffset` answers: `xy` to add to a texel, the layer. */
export const placed = ([x, y]: V) => [
  Math.floor(hash(x * 7 + y * 131) * 32) * PAGE - x * PAGE,
  Math.floor(hash(x * 13 - y * 71) * 32) * PAGE - y * PAGE,
  Math.floor(hash(x - y * 3) * 4),
];
/** A comparison's answer, from all it was handed. */
export const lit = (...args: unknown[]) =>
  hash(
    Math.floor((args.flat(2) as number[]).reduce((sum, x, i) => sum + x * (i + 1.618), 0) * 4096),
  );

type Calls = { neighbour: V[]; compare: unknown[][]; sample: unknown[][]; through: unknown[][] };
const spy = (): Calls => ({ neighbour: [], compare: [], sample: [], through: [] });
/** What a run reads and records: `readable(p)` tells whether neighbour `p` is readable in the
 *  home page's range. Swapped per pixel; the shader text compiles once. */
const live = { readable: (_: V) => false, calls: spy() };
/** The taps' turn, cosine and sine (\`shadowRotation\`): set in place per pixel. */
export const TURN = [1, 0];
/** The taps a read takes, first and stride (`shadowTaps`): set in place per run. */
export const TAPS = [0, 1];
const turned = ([x, y]: V) => [x * TURN[0] - y * TURN[1], x * TURN[1] + y * TURN[0]];
/** The shipped `shadowPcf`, its page reads spied. */
const { shadowPcf } = shaderRun<{ shadowPcf: Pcf }>(
  SHADOW_WGSL,
  [
    'shadowPcf',
    'shadowSplitTap',
    'shadowNeighbours',
    'shadowPcfEdge',
    'shadowPcfStep',
    'shadowRotated',
    'shadowTapAt',
  ],
  {
    ...CONSTANTS,
    shadowRotation: TURN,
    shadowTaps: TAPS,
    ShadowNeighbours: (x: number[], y: number[], d: number[]) => ({ x, y, d }),
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
export function pcfRun(readable: (p: V) => boolean, ...args: Parameters<Pcf>) {
  Object.assign(live, { readable, calls: spy() });
  return { answer: shadowPcf(...args), calls: live.calls };
}

/** A texel coordinate in page `page`: near an edge, on one, or anywhere in it. */
export function coordinate(r: () => number, page: number) {
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
export function expected(
  t: V,
  home: V,
  side: number,
  reference: number,
  readable: (p: V) => boolean,
) {
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
