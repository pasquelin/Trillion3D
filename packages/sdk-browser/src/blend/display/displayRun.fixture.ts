// The display layers' shipped WGSL run in JavaScript (`shaderRun`): the route every
// transparent layer takes, the mask it reads and the display filter pass that composes them. The
// route runs the baking's chain (`../../lighting/toneBakeWgsl.ts`) on the words a view carries.
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import type { ColorGradingSettings } from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { bakeRun } from '../../lighting/toneBake.fixture.ts'
import type { Rgba } from '../blendModel.fixture.ts'
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './displayFilter.ts'
import { DISPLAY_FILTER_SHADER } from './displayFilterWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** The curve the routes are run with: the default display curve. */
export const FILMIC = TONE_MAPPING_RANK.filmic

/** The baking's words a view carries, as the shader reads them, for the colour settings `settings`
 *  and the display curve of rank `rank`: the defaults of the curve the routes are run with. */
export const toneOf = (settings: ColorGradingSettings = {}, rank: number = FILMIC) =>
  bakeRun(settings, rank).bake

type Route = { keep: number; tint: Rgba; add: Rgba }
type Texel = (at: number[]) => unknown

/** The functions a shader that routes its layers adds to its own. */
export const ROUTE_FUNCTIONS = ['displayRoute', 'maskAt']

/** What they run with: the pipeline's `DISPLAY_ROUTE` `kind`, the mask `mask` at a pixel; the film
 *  curve reads a hue as an angle, which the interpreter's built-ins hold no `atan2` for. */
export const routeScope = (kind: 0 | 1 | 2, mask: (at: number[]) => number = () => 1) => ({
  DISPLAY_ROUTE: kind,
  atan2: Math.atan2,
  displayMask: (at: number[]) => [mask(at), 0, 0, 0],
  textureLoad: (texture: Texel, at: number[], level: number) => (
    assert.equal(level, 0),
    texture(at)
  ),
})

type RouteArgs = [
  rgb: number[],
  exposure: number,
  curve: number,
  unlit: boolean,
  alpha: number,
  masked: number,
]
/** The words of the curve's defaults, what a route is run with where it is given none. */
const DEFAULT_TONE = toneOf()

/** The shipped `displayRoute` of a pipeline made with `DISPLAY_ROUTE` `kind`, a view's `tone` words
 *  given last: the curve's defaults where none is. */
const routeOf = (kind: 0 | 1 | 2) => {
  const run = shaderRun<{ displayRoute: (...args: [...RouteArgs, object]) => Route }>(
    wgslModule(DISPLAY_ROUTE_WGSL, displayMaskWgsl(0)),
    ROUTE_FUNCTIONS,
    routeScope(kind),
  ).displayRoute
  return (...args: [...RouteArgs, object?]): Route =>
    run(...(args.slice(0, 6) as RouteArgs), args[6] ?? DEFAULT_TONE)
}

/** The shipped `displayRoute` of each pipeline route: 0 none, 1 where masked, 2 always. */
export const displayRoute = [routeOf(0), routeOf(1), routeOf(2)] as const

type Screen = { position: number[]; uv: number[] }
type Both = { capture: Rgba; canvas: Rgba }
type Filter = {
  screen: (vertex: number) => Screen
  tint: (at: Screen) => Both
  add: (at: Screen) => Both
}

/** The display filter pass's shader over layers `tintMap` and `addMap`, sampled at a place, of
 *  which the image covers the top-left `drawn` share. */
export const displayFilterRun = (
  drawn: [number, number],
  tintMap: (uv: number[]) => number[],
  addMap: (uv: number[]) => number[],
) =>
  shaderRun<Filter>(DISPLAY_FILTER_SHADER, ['screen', 'layer', 'tint', 'add', 'ndcToUv'], {
    tintMap,
    addMap,
    layerSampler: 'linear',
    drawn: [...drawn, 0, 0],
    textureSampleLevel: (map: typeof tintMap, sampler: string, uv: number[], level: number) => (
      assert.deepEqual([sampler, level], ['linear', 0]),
      map(uv)
    ),
  })
