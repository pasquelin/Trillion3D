// The readers of a light's reach (`lightReach.test.ts`), each run from its shipped text: the
// predicate wherever a program holds it, the lighting's incidence, the projection's region test on
// the records its host writes, and the bounce's world light lists, from the reader's cell to the
// run the list pass gives the light in its column.
import type { SceneLight } from '../../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import type { WgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { lightTilesShader } from '../tiles/shader.ts'
import { CODE as PROJECTION, SCOPE as PROJECTION_SCOPE } from '../../vsm/projectionTiles.fixture.ts'
import { encodeVirtualShadowProjection } from '../../vsm/projectionPass.ts'
import {
  VSM_PROJECTION_HEADER_WORDS,
  VSM_PROJECTION_LIGHT_WORD,
  VSM_PROJECTION_LIGHT_WORDS,
} from '../../vsm/projectionView.ts'
import { createVsmResources } from '../../vsm/resources.ts'
import { fakeHizDepth } from '../../vsm/hizDepth.fixture.ts'
import { projectionLight } from '../../webgpu/pages/render/vsm/vsmPlan.ts'
import type { LightRecord, V3 } from './lightReach.fixture.ts'

type Reaches = (offset: V3, range: number, cosEdge: number, forward: V3, rect: boolean) => boolean
/** `localLightReaches` as the program `code` holds it. */
export const reachOf = (code: WgslSource) =>
  shaderRun<{ localLightReaches: Reaches }>(code, ['localLightReaches'], { ...F32_SCOPE })
    .localLightReaches

/** Whether the lighting of `code` gives the light energy at P: a punctual light's attenuation
 *  (`directIncidence`), a rectangle's window (`rectView`), above zero. */
export function shadesOf(code: string) {
  const run = shaderRun<{
    directIncidence: (light: object, P: V3) => number[]
    rectView: (light: object, P: V3) => { window: number }
  }>(code, ['directIncidence', 'isSun', 'isSunKind', 'rangeWindow', 'rectView'], {
    ...F32_SCOPE,
    ...wgslConstants(code),
    RectView: (a: V3, b: V3, c: V3, d: V3, window: number) => ({ a, b, c, d, window }),
  })
  return (light: SceneLight, r: LightRecord, P: V3) =>
    light.kind === 'rect' ? run.rectView(r, P).window > 0 : run.directIncidence(r, P)[3] > 0
}

/** The projection's region test (`vsmLightParticipates`) on a surface that culls no back face,
 *  over the records its host writes for `lights` (`projectionLight`), the eye at the origin. */
export function projectionOf(lights: readonly SceneLight[]) {
  const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const view = {} as GPUTextureView
  encodeVirtualShadowProjection(
    device.createCommandEncoder(),
    res,
    {
      device,
      depth: view,
      hizDepth: fakeHizDepth,
      normalRough: view,
      flags: view,
      mask: view,
      maskTiles: view,
      width: 64,
      height: 32,
      camera: {
        view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0],
        perspective: true,
      },
      frameIndex: 1,
      subgroups: false,
    },
    lights.map((light, k) => projectionLight(light, 8192 + 6 * k)),
  )
  const upload = writes.find((w) => w.buffer.label === 'vsm.projection.view')
  if (!upload) throw new Error('the projection wrote no view')
  const words = upload.size! / 4
  const f = new Float32Array(upload.data.buffer, upload.data.byteOffset, words),
    u = new Uint32Array(upload.data.buffer, upload.data.byteOffset, words),
    W = VSM_PROJECTION_LIGHT_WORD
  const records = lights.map((_, k) => {
    const o = VSM_PROJECTION_HEADER_WORDS + k * VSM_PROJECTION_LIGHT_WORDS
    const v3 = (at: number) => [...f.subarray(o + at, o + at + 3)]
    return {
      shiftedPosition: v3(W.shiftedPosition),
      radius: f[o + W.radius],
      direction: v3(W.direction),
      sourceRadius: f[o + W.sourceRadius],
      cosCone: f[o + W.cosCone],
      mapId: u[o + W.mapId] | 0,
      kind: u[o + W.kind],
    }
  })
  const { vsmLightParticipates } = shaderRun<{
    vsmLightParticipates: (k: number, info: object, P: V3) => boolean
  }>(
    PROJECTION,
    [
      'vsmLightParticipates',
      'vsmLightIsDirectional',
      'localLightReaches',
      'vsmFacesAwayFromSun',
      'vsmFacesAwayFromLocal',
    ],
    { ...PROJECTION_SCOPE, ...F32_SCOPE, vsmView: { lights: records } },
  )
  const surface = { valid: true, subsurface: true, worldNormal: [0, 0, 1], biasNormal: [0, 0, 1] }
  return (k: number, P: V3) => vsmLightParticipates(k, surface, P)
}

/** Whether the bounce's world lists hold the light at P's cell: the lattice of the last cascade
 *  level, 8 m cells, its corner 8 cells below the origin on each axis. The reader's cell is
 *  `bounceLightSlice`'s of `bounce` (a program that walks the lists); the run, `entryOf`'s. */
export function listsOf(bounce: string) {
  const WORLD = lightTilesShader('world')
  const K = wgslConstants(WORLD),
    B = wgslConstants(bounce)
  const side = K.COLUMN_SLICES,
    spacing = 8,
    corner = -side / 2
  const listed = { items: [] as object[] }
  const lists = shaderRun<{
    gridColumn: (cell: number[]) => object
    entryOf: (column: object, index: number) => number[]
  }>(
    WORLD,
    [
      'entryOf',
      'gridColumn',
      'columnGap',
      'runReach',
      'sphereInColumn',
      'lightRun',
      'isSun',
      'isSunKind',
    ],
    {
      ...F32_SCOPE,
      ...K,
      lights: listed,
      view: { origin: [corner * spacing, corner * spacing, corner * spacing, spacing] },
      Column: (low: number[], high: number[]) => ({ low, high }),
    },
  )
  const { bounceLightSlice } = shaderRun<{ bounceLightSlice: (P: V3) => number[] }>(
    bounce,
    ['bounceLightSlice'],
    {
      ...F32_SCOPE,
      ...B,
      bounce: {
        lists: [0, 0, 0, 0],
        counts: [side, 1, 0, 0],
        levels: [
          { base: [corner, corner, corner, 1 / spacing], originSpacing: [0, 0, 0, spacing] },
        ],
      },
      directLights: { count: 1 },
      // The cell's record word itself: the reader's cell, read back below.
      cellSlice: (word: number) => [word, 1],
    },
  )
  return (r: LightRecord, P: V3) => {
    const [word] = bounceLightSlice(P)
    if (word === B.TILE_NO_SLICE) throw new Error(`${P} lies out of the lattice`)
    const cell = word / B.TILE_STRIDE
    const z = cell % side,
      x = Math.floor(cell / side) % side,
      y = Math.floor(cell / (side * side))
    listed.items = [r]
    const run = lists.entryOf(lists.gridColumn([x, y]), 0)[1]
    return (run & 0xffff) <= z && z <= run >>> 16
  }
}
