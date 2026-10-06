// The projection's tile kernel run lane by lane (`projectionTiles.test.ts`): the shipped kernel's
// pieces, every trace call and store recorded, and the kernel before tiles on the same inputs.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import {
  CODE,
  NAMES,
  SCOPE,
  f,
  type Light,
  type Pixel,
  type Result,
  type V3,
} from './projectionTiles.fixture.ts'

/** A light's result at a lane: what the trace would count, a function of what it is handed. */
const traced = (lane: number, k: number, participating: boolean): Result => {
  if (!participating) return { valid: false, shadowFactor: 1, rayCount: 0 }
  const n = 1 + ((lane * 7 + k * 13) % 7)
  return { valid: true, shadowFactor: f(f((lane + k) % (n + 1)) / f(n)), rayCount: n }
}

export interface Run {
  calls: string[]
  stores: Map<string, number>
  tileLayers: number
}

/** One group of the shipped kernel, its 64 lanes run in turn four times: every word one lane
 *  gives another is a greatest or a union, of values that only grow with what the lanes before
 *  gave, so the fourth turn runs on the group's whole words — what the barriers give. */
export function shipped(pixels: Pixel[], lights: Light[], oneLight: boolean, kinds = 0): Run {
  let calls: string[] = []
  let stores = new Map<string, number>()
  let tileLayers = -1
  let lane = 0
  const scope = {
    ...SCOPE,
    VSM_PROJECTION_ONE_LIGHT: oneLight,
    VSM_PROJECTION_KINDS: kinds,
    vsmView: { lights, lightCount: lights.length },
    vsmTileBounds: [0, 0, 0, 0, 0, 0],
    vsmTileHeld: 0,
    vsmTileCandidates: [0, 0],
    vsmTileLights: [0, 0],
    vsmTileRead: [0, 0, 0],
    vsmShadowMask: 'mask',
    vsmShadowMaskTiles: 'tiles',
    vsmLaneInit() {},
    workgroupBarrier() {},
    workgroupUniformLoad: (p: { get: () => unknown }) => p.get(),
    vsmPixelOf: () => pixels[lane],
    vsmProjectLight: (k: number, _pixel: Pixel, participating: boolean) => (
      calls.push(`${lane}:${k}:${participating}`),
      traced(lane, k, participating)
    ),
    textureStore: (texture: string, at: number[], ...rest: unknown[]) => {
      if (texture === 'tiles') tileLayers = (rest[0] as number[])[0]
      else stores.set(`${at}:${rest[0]}`, (rest[1] as number[])[0])
    },
  }
  const { vsmProjection } = shaderRun<{
    vsmProjection: (groupId: number[], groupIndex: number) => void
  }>(CODE, NAMES, scope)
  for (let turn = 0; turn < 4; turn++) {
    calls = []
    stores = new Map()
    for (lane = 0; lane < 64; lane++) vsmProjection([...pixels[0].pos.map((c) => c >> 3), 0], lane)
  }
  return { calls, stores, tileLayers }
}

/** The kernel before tiles, on the same lights: each pixel tests every light, the tile's lights are
 *  their union, each light the tile holds is traced at every lane in increasing order, and every
 *  layer is stored at every pixel of the rect. */
export function reference(pixels: Pixel[], lights: Light[], oneLight: boolean) {
  const { vsmLightParticipates, vsmMaskCode } = shaderRun<{
    vsmLightParticipates: (k: number, info: Pixel['info'], p: V3) => boolean
    vsmMaskCode: (r: Result) => number
  }>(
    CODE,
    [
      'vsmLightParticipates',
      'vsmLightIsDirectional',
      'vsmSpotCone',
      'vsmFacesAwayFromSun',
      'vsmFacesAwayFromLocal',
      'vsmMaskCode',
    ],
    {
      ...SCOPE,
      VSM_PROJECTION_KINDS: 0,
      vsmView: { lights },
    },
  )
  const count = oneLight ? 1 : lights.length
  const inLight = pixels.map((p) =>
    Array.from({ length: count }, (_, k) => vsmLightParticipates(k, p.info, p.shifted)),
  )
  const tile = Array.from({ length: count }, (_, k) => inLight.some((row) => row[k]))
  // Lane by lane, as the shipped run records them: each lane's lights in increasing order.
  const calls: string[] = []
  const codes = pixels.map(() => new Array<number>(count).fill(0))
  for (let lane = 0; lane < 64; lane++)
    for (let k = 0; k < count; k++) {
      if (!tile[k]) continue
      calls.push(`${lane}:${k}:${inLight[lane][k]}`)
      codes[lane][k] = vsmMaskCode(traced(lane, k, inLight[lane][k]))
    }
  return { calls, codes, tile, inLight }
}
