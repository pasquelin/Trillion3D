// The display layers' shipped WGSL (#558) run in JavaScript (`shaderRun`): the route every
// transparent layer takes, the mask it reads and the display filter pass that composes them. The
// tone curve is the witness's (`blendModel.fixture.ts`): the curves are proved on their own.
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts';
import { filmic } from './blendModel.fixture.ts';
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './displayFilter.ts';
import { DISPLAY_FILTER_SHADER } from './displayFilterProgram.ts';

/** The curve the routes are run with, the witness's. */
export const ACES = TONE_MAPPING_RANK.aces;

export type Route = { keep: number; tint: number[]; add: number[] };
type Texel = (at: number[]) => unknown;

/** The functions a shader that routes its layers adds to its own. */
export const ROUTE_FUNCTIONS = ['displayRoute', 'linearToSrgb', 'maskAt'];

/** What they run with: the pipeline's `DISPLAY_ROUTE` `kind`, the mask `mask` at a pixel. */
export const routeScope = (kind: 0 | 1 | 2, mask: (at: number[]) => number = () => 1) => ({
  DISPLAY_ROUTE: kind,
  Route: (keep: number, tint: number[], add: number[]): Route => ({ keep, tint, add }),
  toneMap: (rgb: number[], curve: number) => (assert.equal(curve, ACES), filmic(rgb)),
  displayMask: (at: number[]) => [mask(at), 0, 0, 0],
  textureLoad: (texture: Texel, at: number[], level: number) => (
    assert.equal(level, 0),
    texture(at)
  ),
});

type RouteRun = (
  rgb: number[],
  exposure: number,
  curve: number,
  unlit: boolean,
  alpha: number,
  masked: number,
) => Route;

/** The shipped `displayRoute` of a pipeline made with `DISPLAY_ROUTE` `kind`. */
export const displayRoute = (kind: 0 | 1 | 2) =>
  shaderRun<{ displayRoute: RouteRun }>(
    `${DISPLAY_ROUTE_WGSL}${displayMaskWgsl(0)}`,
    ROUTE_FUNCTIONS,
    routeScope(kind),
  ).displayRoute;

type Screen = { position: number[]; uv: number[] };
type Both = { capture: number[]; canvas: number[] };
type Filter = {
  screen: (vertex: number) => Screen;
  tint: (at: Screen) => Both;
  add: (at: Screen) => Both;
};

/** The display filter pass's shader over layers `tintMap` and `addMap`, sampled at a place, of
 *  which the image covers the top-left `drawn` share. */
export const displayFilterRun = (
  drawn: [number, number],
  tintMap: (uv: number[]) => number[],
  addMap: (uv: number[]) => number[],
) =>
  shaderRun<Filter>(DISPLAY_FILTER_SHADER, ['screen', 'layer', 'tint', 'add'], {
    tintMap,
    addMap,
    layerSampler: 'linear',
    drawn: [...drawn, 0, 0],
    textureSampleLevel: (map: typeof tintMap, sampler: string, uv: number[], level: number) => (
      assert.deepEqual([sampler, level], ['linear', 0]),
      map(uv)
    ),
    Screen: (position: number[], uv: number[]): Screen => ({ position, uv }),
    Both: (capture: number[], canvas: number[]): Both => ({ capture, canvas }),
  });
