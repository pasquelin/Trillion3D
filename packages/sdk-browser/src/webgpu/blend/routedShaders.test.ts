// #558: the transparent layers' routed fragments — particles, water and the blend pass — run from
// their shipped text (`shaderRun`): where the display mask is set a layer leaves the lit target
// and maps the tint and the added value by its display colour, elsewhere it draws as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { close, display, srgb } from './blendModel.fixture.ts';
import { ACES, ROUTE_FUNCTIONS, routeScope, type Route } from './displayRun.fixture.ts';
import { PARTICLE_ROUTED_WGSL } from '../../particles/webgpuParticleDraw.ts';
import { WATER_ROUTED_SHADER } from '../water/compositeWgsl.ts';
import { BLEND_SHADER } from './shader.ts';
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { FOG_FREE_MODEL_BIT, MODEL_SHIFT } from '../../scene/surfaceModel.ts';
import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts';

type Layers = { color: number[]; tint: number[]; add: number[] };
const layers = (color: number[], tint: number[], add: number[]): Layers => ({ color, tint, add });
/** The mask of an image where only the pixel column `x < 4` is covered. */
const leftHalf = (at: number[]) => (at[0] < 4 ? 1 : 0);
const PIXELS = [
  [2, 3, 0, 1],
  [6, 3, 0, 1],
];

/** What a routed layer of straight colour `rgb` and coverage `a` owes at the pixel `masked` or
 *  not: `shown` its display value. */
function owed(rgb: number[], a: number, masked: number, shown = display(rgb)) {
  return layers(
    [...rgb, a * (1 - masked)],
    [0, 0, 0, a * masked],
    [...shown.map((v) => v * a * masked), a * masked],
  );
}

function assertLayers(actual: Layers, expected: Layers, name: string) {
  close(actual.color, expected.color, `${name} lit`);
  close(actual.tint, expected.tint, `${name} tint`, 1e-5);
  close(actual.add, expected.add, `${name} added value`, 1e-5);
}

test('a particle routes its straight colour, where the mask is set', () => {
  const color = [0.6, 0.3, 0.2, 0.5];
  const scope = {
    ...routeScope(1, leftHalf),
    draw: { drawn: [8, 8], unclip: new Mat([...IDENTITY_MATRIX4]), eye: [0, 0, 5] },
    depth: () => 0,
    Routed: (lit: number[], tint: number[], add: number[], reactive: number[]) => ({
      ...layers(lit, tint, add),
      reactive,
    }),
  };
  type Particle = { fsRouted: (at: object) => Layers & { reactive: number[] } };
  for (const unlit of [0, 1]) {
    Object.assign(scope.draw, { softness: 1, color, exposure: 1, curve: ACES, unlit });
    const { fsRouted } = shaderRun<Particle>(
      PARTICLE_ROUTED_WGSL,
      ['fsRouted', 'particle', ...ROUTE_FUNCTIONS],
      scope,
    );
    for (const at of PIXELS) {
      // A disc's centre, in full life, one unit from the eye and well in front of the scene.
      const out = fsRouted({ at, corner: [0, 0], local: [0, 0, 4], life: 1 });
      const masked = leftHalf(at),
        rgb = color.slice(0, 3);
      const expected = owed(rgb, 0.5, masked, unlit ? srgb(rgb) : display(rgb));
      // The lit target takes the premultiplied disc, the reactive value its whole coverage.
      expected.color = [...rgb.map((v) => v * 0.5), 0.5].map((v) => v * (1 - masked));
      assertLayers(out, expected, `particle at ${at}, unlit ${unlit}`);
      close(out.reactive, [0, 1, 0, 0.5], 'reactive');
    }
  }
});

test('water routes the colour it composed, lit or unlit', () => {
  const water = [0.05, 0.2, 0.3, 0.8];
  type Water = { composeWaterRouted: (pixel: number[]) => Layers };
  for (const viewFlags of [0, FLAG_UNLIT_VIEW]) {
    const { composeWaterRouted } = shaderRun<Water>(
      WATER_ROUTED_SHADER,
      ['composeWaterRouted', ...ROUTE_FUNCTIONS],
      {
        ...routeScope(1, leftHalf),
        waterColor: () => water,
        uni: { viewFlags, exposure: 1, toneCurve: ACES },
        Routed: layers,
      },
    );
    const rgb = water.slice(0, 3);
    for (const pixel of PIXELS)
      assertLayers(
        composeWaterRouted(pixel),
        owed(rgb, 0.8, leftHalf(pixel), viewFlags ? srgb(rgb) : display(rgb)),
        `water at ${pixel}, flags ${viewFlags}`,
      );
  }
});

test('a blended surface routes through its pipeline, and the unfiltered one never', () => {
  const surface = { rgb: [0.4, 0.5, 0.9], alpha: 0.7, rough: 0.5, request: 9 };
  const fogFree = FOG_FREE_MODEL_BIT << MODEL_SHIFT;
  type Out = Layers & { request: number; asIs: number[] };
  type Fragment = (at: object, front: boolean) => Out;
  for (const kind of [1, 2] as const)
    for (const flags of [fogFree, FLAG_UNLIT_VIEW]) {
      const run = shaderRun<{ fs: Fragment; fsFiltered: Fragment }>(
        BLEND_SHADER,
        ['fs', 'fsFiltered', 'blendFragment', ...ROUTE_FUNCTIONS],
        {
          ...routeScope(kind, leftHalf),
          fwidth: () => [0, 0, 0],
          lineDash: () => true,
          blendSurface: () => surface,
          uni: { camPos: [0, 0, 5, 1], exposure: 1, toneCurve: ACES },
          BlendOut: (
            color: number[],
            request: number,
            asIs: number[],
            tint: number[],
            add: number[],
          ) => ({
            ...layers(color, tint, add),
            request,
            asIs,
          }),
        },
      );
      const shown = flags === FLAG_UNLIT_VIEW ? srgb(surface.rgb) : display(surface.rgb);
      for (const position of PIXELS) {
        const at = {
          ids: [0, flags, 0],
          uv: [0, 0],
          alphaAo: [0, 0, 0, 0],
          view: [0, 0, 0],
          position,
        };
        const name = `route ${kind}, flags ${flags}, at ${position}`;
        for (const [out, masked] of [
          [run.fsFiltered(at, true), leftHalf(position)],
          [run.fs(at, true), 0],
        ] as const) {
          const route: Route =
            kind === 2
              ? { keep: 1, tint: [...shown, 1], add: [...shown, 1] }
              : {
                  keep: 1 - masked,
                  tint: owed(surface.rgb, surface.alpha, masked, shown).tint,
                  add: owed(surface.rgb, surface.alpha, masked, shown).add,
                };
          const kept = surface.alpha * route.keep;
          assertLayers(out, layers([...surface.rgb, kept], route.tint, route.add), name);
          assert.equal(out.request, surface.request);
          close(out.asIs, [0, 1, 0, kept], `${name} as-is`);
        }
      }
    }
});
