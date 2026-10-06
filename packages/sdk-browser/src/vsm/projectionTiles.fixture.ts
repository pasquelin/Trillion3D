// The projection's tiles under test (`projectionTiles.test.ts`, `projectionTileBox.test.ts`): the
// shipped module, generated tiles and lights, and what `shaderRun` needs to run the kernel's pieces.
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { builtins } from '../texture/shaderRunBuiltins.fixture.ts'
import {
  VSM_LIGHT_KIND_DIRECTIONAL as DIRECTIONAL,
  VSM_LIGHT_KIND_POINT as POINT,
  VSM_LIGHT_KIND_RECT as RECT,
  VSM_LIGHT_KIND_SPOT as SPOT,
} from './constants.ts'
import { vsmProjectionWgsl } from './projectionWgsl.ts'
import { vsmLayout } from './layout.ts'

export const CODE = vsmProjectionWgsl(
  vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27),
  { subgroups: false },
)
export const f = Math.fround
export type V3 = [number, number, number]
export interface Light {
  shiftedPosition: V3
  invRadius: number
  direction: V3
  sourceRadius: number
  spotAngles: [number, number]
  mapId: number
  kind: number
}
export interface Pixel {
  pos: [number, number]
  inRect: boolean
  info: {
    valid: boolean
    subsurface: boolean
    worldNormal: V3
    biasNormal: V3
  }
  sceneDepth: number
  shifted: V3
  screenRayWorld: number
  noise: number
}
export type Result = { valid: boolean; shadowFactor: number; rayCount: number }

const unit = (v: number[]) => {
  const l = Math.hypot(...v)
  return v.map((x) => f(x / l)) as V3
}

/** A frame of `count` lights around a tile near the origin: suns, points, spots, rectangles,
 *  unbounded lamps; some lamps' spheres end a few units in the last place past or short of a
 *  pixel of the tile (`edge`) — with `corner`, the tile's least corner, half of them beyond it,
 *  where that pixel is the box's nearest point. */
export function lightsOf(rand: () => number, count: number, edge: V3[], corner?: V3): Light[] {
  return Array.from({ length: count }, (_, k) => {
    const kind = [DIRECTIONAL, POINT, SPOT, RECT, POINT, SPOT][Math.floor(rand() * 6)]
    let at: V3 = [0, 1, 2].map(() => f((rand() - 0.5) * 40)) as V3
    if (corner && rand() < 0.5)
      at = corner.map((c) => f(c - (0.1 + rand()) * (0.5 + rand() * 8))) as V3
    let radius = 0.5 + rand() * 20
    if (kind !== DIRECTIONAL && rand() < (corner ? 0.6 : 0.3)) {
      // Its sphere through a pixel of the tile, give or take a few units in the last place.
      const p = corner ?? edge[Math.floor(rand() * edge.length)]
      const d = Math.hypot(at[0] - p[0], at[1] - p[1], at[2] - p[2])
      radius = d * (1 + (Math.floor(rand() * 9) - 4) * 2 ** -23)
    }
    const unbounded = kind !== DIRECTIONAL && rand() < 0.05
    const cosOuter = f(Math.cos(0.2 + rand() * 1.2))
    return {
      shiftedPosition: at,
      invRadius: unbounded ? 0 : f(1 / radius),
      direction: unit([rand() - 0.5, rand() - 0.5, rand() - 0.5]),
      sourceRadius: f(rand() * 0.5),
      spotAngles: kind === SPOT ? [cosOuter, f(1 / (1 - cosOuter))] : [-2, 1],
      mapId: k,
      kind,
    }
  })
}

/** Tile `group`'s 64 pixels (Z-order is the kernel's own, not needed here): a surface patch
 *  with lit, sky and out-of-rect pixels, in the proportions `kind` asks; a `corner` patch rises on
 *  every axis from its first pixel, which faces down every axis. */
export function pixelsOf(rand: () => number, group: [number, number], kind: string): Pixel[] {
  const origin: V3 = [0, 1, 2].map(() => (rand() - 0.5) * 6) as V3
  const scale = kind === 'far' ? 30 : 0.5 + rand() * 4
  return Array.from({ length: 64 }, (_, i) => {
    const x = i & 7,
      y = i >> 3
    const pos: [number, number] = [8 * group[0] + x, 8 * group[1] + y]
    const inRect = kind !== 'edge' || x < 5
    const lit = kind !== 'sky' && (kind !== 'mixed' || rand() < 0.6)
    const valid = inRect && lit
    const shifted: V3 = valid
      ? ([
          f(origin[0] + (x / 8) * scale),
          f(origin[1] + (y / 8) * scale),
          f(origin[2] + (kind === 'corner' ? (x + y) / 16 : rand()) * scale * 0.3),
        ] as V3)
      : [0, 0, 0]
    if (valid && kind === 'infinite' && i === 9) shifted[1] = Infinity
    const facing = kind === 'corner' ? [-1, -1, -1] : [0, 0, 1]
    const normal = valid ? unit(facing.map((c) => c + rand() - 0.5)) : ([0, 0, 0] as V3)
    const subsurface = rand() < 0.1
    return {
      pos,
      inRect,
      info: {
        valid,
        subsurface,
        worldNormal: normal,
        biasNormal: normal,
      },
      sceneDepth: valid ? 1 + rand() * 10 : 0,
      shifted,
      screenRayWorld: 0,
      noise: 0,
    }
  })
}

/** What a run of the kernel's pieces reads beside them: the module's constants, an inverse square
 *  root, and a vector's bits as floats. Its integer words stay exact: no binary32 rounding of
 *  their arithmetic (\`F32_SCOPE\` rounds every sum). */
export const SCOPE = {
  ...wgslConstants(CODE),
  inverseSqrt: (x: number) => 1 / Math.sqrt(x),
  bitcast_vec3f: builtins.bitcast_f32,
}
export const NAMES = [
  'vsmProjection',
  'vsmTileBound',
  'vsmTileCandidate',
  'vsmPixelLights',
  'vsmTileLayers',
  'vsmProjectTile',
  'vsmLightParticipates',
  'vsmLightMayReachTile',
  'vsmOrderedKey',
  'vsmOrderedValue',
  'vsmLightIsDirectional',
  'vsmSpotCone',
  'vsmFacesAwayFromSun',
  'vsmFacesAwayFromLocal',
  'vsmMaskCode',
  'vsmLayerLights',
  'vsmLightsBelow',
]

export const CASES = ['lit', 'mixed', 'sky', 'edge', 'far', 'infinite', 'corner']
