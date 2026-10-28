import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_CM_PER_UNIT } from '../constants.ts'
import { DEFAULT_SUN_CASCADES, type SunCascadeSettings } from '../../classic/cascadeSplits.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import {
  DENSE_ENTRY_WORDS,
  DENSE_MAX_ENTRIES,
  nearInCentimetres,
  writeDenseEntries,
  type DenseLocal,
  type DenseSun,
} from '../../classic/denseEntries.ts'
import type { VsmFramePlan } from '../frameSetup.ts'
import { vsmLocalShadowResolution, type VsmGateView } from '../localGate.ts'

const data = new ArrayBuffer(DENSE_MAX_ENTRIES * DENSE_ENTRY_WORDS * 4)
const words = new Uint32Array(data)
const floats = new Float32Array(data)
/** A sun's cascade settings: its own fields, the default of a sun for those it names none (`DEFAULT_SUN_CASCADES`), its distance in centimetres. */
export const sunCascadesOf = (light: SceneLight): SunCascadeSettings => ({
  cascades: light.dynamicShadowCascades ?? DEFAULT_SUN_CASCADES.cascades,
  exponent: light.cascadeDistributionExponent ?? DEFAULT_SUN_CASCADES.exponent,
  transitionFraction: light.cascadeTransitionFraction ?? DEFAULT_SUN_CASCADES.transitionFraction,
  distance:
    light.dynamicShadowDistance === undefined
      ? DEFAULT_SUN_CASCADES.distance
      : light.dynamicShadowDistance * VSM_CM_PER_UNIT,
})

const suns: DenseSun[] = []
const locals: DenseLocal[] = []
const forward = [0, 0, 0]
const gateView: VsmGateView = { projection: [], eye: [], width: 0, height: 0 }

/** The suns and the local lights of the plan's lanes, into `suns` and `locals`: a sun by the cascades its light names, a local light by the resolution its view asks. */
function collectDenseLanes(
  store: NonNullable<WebgpuPagesRuntime['lights']>['store'],
  cam: EngineCamera,
  plan: VsmFramePlan,
  shadows: ShadowValues,
  width: number,
  height: number,
) {
  suns.length = 0
  locals.length = 0
  gateView.projection = cam.projection
  gateView.eye = cam.eye
  gateView.width = width
  gateView.height = height
  for (const lane of plan.projected) {
    if (lane.firstPerson) continue
    const clipmap = lane.clipmap
    const light = store.light(lane.id)
    if (clipmap) {
      suns.push({
        firstId: lane.firstId,
        firstLevel: clipmap.firstLevel,
        levelCount: clipmap.levels.length,
        settings: light && sunCascadesOf(light),
      })
      continue
    }
    if (!light || !light.position || !light.range) continue
    locals.push({
      firstId: lane.firstId,
      mapCount: lane.count,
      resolution: vsmLocalShadowResolution(light, gateView, shadows),
    })
  }
}

/**
 * THE CLASSIC SHADOW MAPS OF A FRAME (`shadowVirtualEnable` off): the entries of the pages every light draws (`denseEntries.ts`), which the marking asks for in place of the pages
 * the pixels of the view mark. Rewritten in place each frame; undefined while the virtual shadow maps are on, so that such a frame makes nothing of this.
 */
export function denseOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  plan: VsmFramePlan,
  shadows: ShadowValues,
  width: number,
  height: number,
) {
  if (shadows.shadowVirtualEnable) return undefined
  const store = rt.lights?.store
  if (!store) return undefined
  collectDenseLanes(store, cam, plan, shadows, width, height)
  // The camera looks down its world matrix's −Z.
  forward[0] = -cam.world[8]!
  forward[1] = -cam.world[9]!
  forward[2] = -cam.world[10]!
  const count = writeDenseEntries(
    words,
    floats,
    suns,
    locals,
    {
      perspective: cam.perspective > 0.5,
      forward,
      tanX: 1 / cam.projection[0]!,
      tanY: 1 / cam.projection[5]!,
    },
    {
      distanceScale: shadows.shadowDistanceScale,
      maxCascades: shadows.shadowCsmMaxCascades,
      transitionScale: shadows.shadowCsmTransitionScale,
      near: nearInCentimetres(cam.near),
    },
    shadows.shadowMaxCsmResolution,
  )
  return { words, count }
}
