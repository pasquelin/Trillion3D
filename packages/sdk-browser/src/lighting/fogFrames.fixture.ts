// A lit scene drawn by the engine's own frame on the kit's device, for the tests of what the frame
// does with the fog (`fogFrames.test.ts`).
import type { SceneFog } from '../../../sdk-core/src/scene/core/fog.ts'
import type { EngineContext } from '../session/engine/types.ts'
import { drawnQuad } from '../frame/backend/drawnQuad.fixture.ts'
import { camera as quadCamera } from '../frame/backend/testScenes.fixture.ts'
import { renderWebgpuPages } from '../frame/render/render.ts'
import { flushWebgpuPages } from '../frame/render/flush.ts'
import { DEFERRED_LIGHTING_PASS } from '../diagnostic/stage/passLabels.ts'

/** A lit scene drawn by the engine's own frame on the kit's device: a sun, the fog `fog`, and the
 *  frames its pipelines compile in (a frame is held while one does). */
export async function litFrames(fog?: SceneFog, options: Partial<EngineContext> = {}) {
  const { rt, gpu } = await drawnQuad(options)
  rt.lights.store.setView('lit')
  rt.lights.store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 3,
    castsShadow: false,
  })
  rt.lights.store.setEnvironment({ exposure: 1, fog })
  const draw = async () => {
    gpu.commands.length = 0
    gpu.dispatches.length = 0
    renderWebgpuPages(rt, quadCamera())
    await flushWebgpuPages(rt)
    return [...gpu.commands]
  }
  for (let i = 0; i < 6; i++) await draw()
  return { rt, gpu, draw }
}
export const FOG_PASS = 'compute Trillion3D fog volume'
export const LIGHTING_PASS = `render ${DEFERRED_LIGHTING_PASS}`
