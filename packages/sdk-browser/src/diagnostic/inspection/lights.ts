import { FRUSTUM_PLANE_VALUES } from '../../../../math/src/geometry/frustum/frustum.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { vsmLightSeen, vsmSeenPlanes } from '../../lighting/shadows/vsm/seenLights.ts'
import { lightDrawViewOf, type LightDrawSettings } from '../../lighting/lightDrawRange.ts'
import type { InspectedLight } from './types.ts'

const copy = (v?: readonly number[]): [number, number, number] | undefined =>
  v && [v[0], v[1], v[2]]

/** Every light of `store`, and whether its reach meets the view of `cam` over `size` pixels and the
 *  view draws it (`settings`): the test that spares an unseen light its shadow map (`vsmLightSeen`). */
export function inspectedLights(
  store: SceneLightStore,
  cam: Pick<EngineCamera, 'view' | 'projection' | 'eye' | 'perspective' | 'fov' | 'aspect'>,
  size: readonly number[],
  settings: LightDrawSettings,
): InspectedLight[] {
  const draw = lightDrawViewOf(cam, store, settings)
  const planes = vsmSeenPlanes(
    new Float64Array(FRUSTUM_PLANE_VALUES),
    cam.view,
    cam.projection,
    size[0],
    size[1],
  )
  const lights: InspectedLight[] = []
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])
    if (!light) continue
    lights.push({
      id: light.id,
      kind: light.kind,
      position: copy(light.position),
      direction: copy(light.direction),
      range: light.range,
      castsShadow: light.castsShadow,
      seen: vsmLightSeen(light, slot, planes, draw),
    })
  }
  return lights
}
