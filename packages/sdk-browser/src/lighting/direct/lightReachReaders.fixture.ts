// The readers of a light's reach (`lightReach.test.ts`), each run from its shipped text: the
// predicate wherever a program holds it, the lighting's lamp, and the projection's region test on
// the records its host writes.
import { LIGHT_SETTINGS, type SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import type { WgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import {
  PROJECTION_CODE,
  PROJECTION_SCOPE,
} from '../shadows/vsm/projection/projectionRun.fixture.ts'
import { projectionKit } from '../shadows/vsm/projection/projectionKit.fixture.ts'
import {
  VSM_PROJECTION_HEADER_WORDS,
  VSM_PROJECTION_LIGHT_WORD,
  VSM_PROJECTION_LIGHT_WORDS,
} from '../shadows/vsm/projection/projectionView.ts'
import { projectionLight } from '../shadows/vsm/frame/vsmPlan.ts'
import type { LightRecord, V3 } from './lightReach.fixture.ts'

type Reaches = (offset: V3, range: number, cosEdge: number, forward: V3, rect: boolean) => boolean
/** `localLightReaches` as the program `code` holds it. */
export const reachOf = (code: WgslSource) =>
  shaderRun<{ localLightReaches: Reaches }>(code, ['localLightReaches'], { ...F32_SCOPE })
    .localLightReaches

/** Whether the lighting of `code` gives the light energy at P: its term's reach test
 *  (`lightReaches`, on the light's rank in the buffer), then a punctual light's falloff (`lampSeen`) or a
 *  rectangle's window (`rectView`) above zero. */
export function shadesOf(code: string) {
  const directLights = { items: [] as object[] }
  const run = shaderRun<{
    lightReaches: (rank: number, P: V3) => boolean
    lampSeen: (light: object, P: V3, N: V3, bias: number) => { falloff: number }
    rectView: (light: object, P: V3) => { window: number }
  }>(code, ['lightReaches', 'lampSeen', 'rectView'], {
    ...F32_SCOPE,
    ...wgslConstants(code),
    directLights,
  })
  return (light: SceneLight, r: LightRecord, P: V3) => {
    directLights.items[0] = r
    return (
      run.lightReaches(0, P) &&
      (light.kind === 'rect'
        ? run.rectView(r, P).window > 0
        : run.lampSeen(r, P, [0, 1, 0], LIGHT_SETTINGS.lampDistanceBias).falloff > 0)
    )
  }
}

/** The records the projection's host writes for `lights` (`projectionLight`), as its shader reads
 *  them, the eye at the origin. */
export function projectionRecords(lights: readonly SceneLight[]) {
  const kit = projectionKit()
  kit.project(lights.map((light, k) => projectionLight(light, 8192 + 6 * k)))
  const upload = kit.upload()
  if (!upload) throw new Error('the projection wrote no view')
  const words = upload.size! / 4
  const f = new Float32Array(upload.data.buffer, upload.data.byteOffset, words),
    u = new Uint32Array(upload.data.buffer, upload.data.byteOffset, words),
    W = VSM_PROJECTION_LIGHT_WORD
  return lights.map((_, k) => {
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
}

/** The projection's region test (`vsmLightParticipates`) over the records its host writes for
 *  `lights` (`projectionRecords`), the eye at the origin, on a surface that culls no back face —
 *  a thin one — or, given its normal, on a solid one that does. */
export function projectionOf(lights: readonly SceneLight[], normal?: V3) {
  const records = projectionRecords(lights)
  const { vsmLightParticipates } = shaderRun<{
    vsmLightParticipates: (k: number, info: object, P: V3) => boolean
  }>(
    PROJECTION_CODE,
    [
      'vsmLightParticipates',
      'vsmLightIsDirectional',
      'localLightReaches',
      'vsmFacesAwayFromSun',
      'vsmFacesAwayFromLocal',
    ],
    { ...PROJECTION_SCOPE, ...F32_SCOPE, vsm: { cullBackfacing: 1 }, vsmView: { lights: records } },
  )
  const worldNormal = normal ?? [0, 0, 1]
  const surface = { valid: true, subsurface: !normal, worldNormal }
  return (k: number, P: V3) => vsmLightParticipates(k, surface, P)
}
