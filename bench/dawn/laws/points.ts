// The scale laws: for each, the quantity that grows, its points, the bench options each point runs
// with on the scene family (`world.html`), the cooked scene it reads, and the law an open-world
// engine should obey. Pure: `sweep.ts` runs them.
import { pathToFileURL } from 'node:url'
import { manifestOf } from './cook.ts'

/** One point of a law: its abscissa, the run's options, and the cooked scene it reads — the world
 *  of that many objects, `object`, or none. */
type LawPoint = { x: number; args: string[]; scene: number | 'object' | null }
export type Law = { name: string; x: string; should: string; points: LawPoint[] }

/** The engine's screen-error bound the laws hold the cut to, pixels. */
const PIXEL_ERROR = 1
/** The cooked world every law but the world's reads: ten thousand objects. */
const BASE_WORLD = 10_000

const cacheOf = (scene: number | 'object') =>
  pathToFileURL(manifestOf(scene === 'object' ? 'object' : `world-${scene}`)).href
const switches = (values: Record<string, string | number>) =>
  Object.entries(values).flatMap(([key, value]) => ['--switch', `${key}=${value}`])
const cooked = (scene: number | 'object', values: Record<string, string | number> = {}) =>
  switches({ cache: cacheOf(scene), pe: PIXEL_ERROR, ...values })

/** The display sizes of the pixel law: a quarter to the whole of the desktop's, at density 2. */
const DISPLAYS = [
  [1028, 572],
  [2056, 1144],
  [3084, 1716],
  [4112, 2294],
]

export const LAWS: Record<string, () => Law> = {
  world: () => ({
    name: 'world',
    x: 'objects N',
    should: 'O(1) in N once the view is saturated',
    points: [1e3, 1e4, 1e5, 3e5, 1e6].map((n) => ({ x: n, args: cooked(n), scene: n })),
  }),
  reach: () => ({
    name: 'reach',
    x: 'objects N, far plane 300 m',
    should: 'O(1) in N once the world passes the far plane',
    points: [1e3, 1e4, 1e5, 3e5, 1e6].map((n) => ({
      x: n,
      args: cooked(n, { far: 300 }),
      scene: n,
    })),
  }),
  runtime: () => ({
    name: 'runtime',
    x: 'objects N (built in the page)',
    should: 'O(1) in N once the view is saturated',
    points: [1e3, 1e4, 3e4, 1e5].map((n) => ({
      x: n,
      args: switches({ runtime: n, pe: PIXEL_ERROR }),
      scene: null,
    })),
  }),
  pixels: () => ({
    name: 'pixels',
    x: 'display pixels',
    should: 'O(P): every pass linear in the pixels it draws, no fixed cost to speak of',
    points: DISPLAYS.map(([w, h]) => ({
      x: w * h,
      args: ['--display', `${w}x${h}@2`, ...cooked(BASE_WORLD, { gloss: 1 })],
      scene: BASE_WORLD,
    })),
  }),
  lights: () => ({
    name: 'lights',
    x: 'shadowed lamps L',
    should: 'O(L · pixels each lamp reaches), never O(L · P)',
    points: [0, 1, 2, 4, 8, 16, 32, 64].map((l) => ({
      x: l,
      args: cooked(BASE_WORLD, { sun: 0, lights: l }),
      scene: BASE_WORLD,
    })),
  }),
  isolate: () => ({
    name: 'isolate',
    x: 'features (0 sky only, 1 + sun, 2 + glossy floor and metal, 3 + 4 lamps)',
    should: 'each feature adding the cost of its own passes, nothing to the others',
    points: [
      { sun: 0, gloss: 0, lights: 0 },
      { sun: 1, gloss: 0, lights: 0 },
      { sun: 1, gloss: 1, lights: 0 },
      { sun: 1, gloss: 1, lights: 4 },
    ].map((features, x) => ({ x, args: cooked(BASE_WORLD, features), scene: BASE_WORLD })),
  }),
  distance: () => ({
    name: 'distance',
    x: 'distance m (1 m sphere)',
    should: 'triangles following the covered pixels at the 1 px bound, down to one cluster',
    points: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024].map((d) => ({
      x: d,
      args: cooked('object', { distance: d }),
      scene: 'object',
    })),
  }),
}

/** The law `name`, or a refusal naming the laws. */
export function lawOf(name: string) {
  const law = LAWS[name]
  if (!law) throw new Error(`LAW: ${name}; one of ${Object.keys(LAWS).join(', ')}`)
  return law()
}
