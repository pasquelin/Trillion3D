// The transparent layers' routed fragments — particles and the blend pass — run from
// their shipped text (`shaderRun`): where the display mask is set a layer leaves the lit target
// and maps the tint and the added value by its display colour, elsewhere it draws unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../materials/texture/shaderRunMatrix.fixture.ts'
import { close, display, srgb } from './blendModel.fixture.ts'
import { FILMIC, ROUTE_FUNCTIONS, routeScope, toneOf } from './display/displayRun.fixture.ts'
import { PARTICLE_DRAW_WGSL } from '../particles/gpu/particlesWgsl.ts'
import { FLAG_UNLIT_VIEW } from '../visibility/types.ts'
import { FOG_FREE_MODEL_BIT, MODEL_SHIFT } from '../materials/surface/surfaceModelWord.ts'
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { BLEND_SHADER } from '../gpu/core/shaderTexts.fixture.ts'

type Layers = { color: number[]; tint: number[]; add: number[] }
const layers = (color: number[], tint: number[], add: number[]): Layers => ({ color, tint, add })
/** The mask of an image where only the pixel column `x < 4` is covered. */
const leftHalf = (at: number[]) => (at[0] < 4 ? 1 : 0)
const PIXELS = [
  [2, 3, 0, 1],
  [6, 3, 0, 1],
]

/** What a routed layer of straight colour `rgb` and coverage `a` owes at the pixel `masked` or
 *  not: `shown` its display value. */
function owed(rgb: number[], a: number, masked: number, shown = display(rgb)) {
  return layers(
    [...rgb, a * (1 - masked)],
    [0, 0, 0, a * masked],
    [...shown.map((v) => v * a * masked), a * masked],
  )
}

function assertLayers(actual: Layers, expected: Layers, name: string) {
  close(actual.color, expected.color, `${name} lit`)
  close(actual.tint, expected.tint, `${name} tint`, 1e-5)
  close(actual.add, expected.add, `${name} added value`, 1e-5)
}

test('a particle routes its straight colour, where the mask is set', () => {
  const color = [0.6, 0.3, 0.2, 0.5]
  const scope = {
    ...routeScope(1, leftHalf),
    draw: {
      ...{
        drawn: [8, 8],
        unclip: new Mat([...IDENTITY_MATRIX4]),
        forward: [0, 0, -1],
        softness: 1,
      },
      bake: toneOf(),
    },
    depth: () => 0,
    Routed: (lit: number[], tint: number[], add: number[]) => layers(lit, tint, add),
  }
  type Particle = { fsRouted: (at: object) => Layers }
  const { fsRouted } = shaderRun<Particle>(
    PARTICLE_DRAW_WGSL,
    ['fsRouted', 'particle', 'perspectiveDivide', 'preExposed', ...ROUTE_FUNCTIONS],
    scope,
  )
  // The uniform is read at each call: one run serves both views.
  for (const unlit of [0, 1]) {
    Object.assign(scope.draw, { exposure: 1, preExposure: 1, curve: FILMIC, unlit })
    for (const at of PIXELS) {
      // A disc's centre, in full life (the colour its vertex gave it), one unit from the eye and well
      // in front of the scene.
      const out = fsRouted({ at, corner: [0, 0], local: [0, 0, 4], color })
      const masked = leftHalf(at),
        rgb = color.slice(0, 3)
      const expected = owed(rgb, 0.5, masked, unlit ? srgb(rgb) : display(rgb))
      // The lit target takes the premultiplied disc.
      expected.color = [...rgb.map((v) => v * 0.5), 0.5].map((v) => v * (1 - masked))
      assertLayers(out, expected, `particle at ${at}, unlit ${unlit}`)
    }
  }
})

test('a blended surface routes through its pipeline, and the unfiltered one never', () => {
  const surface = { rgb: [0.4, 0.5, 0.9], emissive: [0, 0, 0], alpha: 0.7, rough: 0.5, request: 9 }
  const fogFree = FOG_FREE_MODEL_BIT << MODEL_SHIFT
  type Out = Layers & { request: number }
  type Fragment = (at: object, front: boolean) => Out
  for (const kind of [1, 2] as const) {
    const run = shaderRun<{ fs: Fragment; fsFiltered: Fragment }>(
      BLEND_SHADER,
      [
        'fs',
        'fsFiltered',
        'sceneVsOut',
        'fsBody',
        'fsFilteredBody',
        'blendFragment',
        'blendLit',
        'preExposed',
        'preExposedClipped',
        ...ROUTE_FUNCTIONS,
      ],
      {
        ...routeScope(kind, leftHalf),
        fwidth: () => [0, 0, 0],
        lineDash: () => true,
        blendGrads: () => ({}),
        blendBase: () => [0, 0, 0, 1],
        blendKeeps: () => true,
        reflectionFrontOut: () => [0, 0, 0, 0],
        // The lobed program's: an item that names no physical record sets nothing.
        blendPhysicalBegin: () => undefined,
        blendSurface: () => surface,
        // The diagnostic palettes' lookups, never reached by a beauty item.
        diagnosticLevel: () => [0, 0, 0],
        diagnosticHlod: () => [0, 0, 0],
        uni: {
          ...{
            camPos: [0, 0, 5, 1],
            exposure: 1,
            preExposure: 1,
            toneCurve: FILMIC,
            bake: toneOf(),
            reduced: [1, 1],
          },
          clipPlane: [0, 0, 0, 0],
        },
        // No as-is share among the outputs: a debug view's as-is pixels are composed from the
        // surfaces after the temporal pass (it was written at the layer's coverage).
        BlendOut: (color: number[], request: number, tint: number[], add: number[]) => ({
          ...layers(color, tint, add),
          request,
        }),
      },
    )
    for (const flags of [fogFree, FLAG_UNLIT_VIEW]) {
      const shown = flags === FLAG_UNLIT_VIEW ? srgb(surface.rgb) : display(surface.rgb)
      for (const position of PIXELS) {
        const at = {
          ids: [0, flags, 0],
          words: [0, 0, 0],
          uv: [0, 0],
          alphaAo: [0, 0, 0, 0],
          view: [0, 0, 0],
          position,
        }
        const name = `route ${kind}, flags ${flags}, at ${position}`
        for (const [out, masked] of [
          [run.fsFiltered(at, true), leftHalf(position)],
          [run.fs(at, true), 0],
        ] as const) {
          // Route 2 filters the whole surface: the lit target keeps it, both layers its display value.
          const route =
            kind === 2
              ? layers([...surface.rgb, surface.alpha], [...shown, 1], [...shown, 1])
              : owed(surface.rgb, surface.alpha, masked, shown)
          assertLayers(out, route, name)
          assert.equal(out.request, surface.request)
        }
      }
    }
  }
})
