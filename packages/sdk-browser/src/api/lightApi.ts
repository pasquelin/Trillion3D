import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts'
import {
  LIGHT_SETTINGS,
  type SceneLight,
  type SceneLightingView,
} from '../../../sdk-core/src/scene/light/contracts.ts'
import type { SceneEnvironment } from '../../../sdk-core/src/scene/core/environment.ts'
import type { LightingCapabilities } from '../../../sdk-core/src/scene/light/capabilities.ts'
import type { SceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import type { SimpleLightEntry } from '../../../sdk-core/src/scene/light/simpleLights.ts'
import { cloneSceneLight } from '../../../sdk-core/src/scene/light/clone.ts'
import type { ResolvedSky } from '../../../sdk-core/src/modules/sky/descriptor.ts'
import type { Engine } from '../session/engine/types.ts'
import { requiredStore } from './namedStoreApi.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

type Inputs = {
  check: () => void
  store: SceneLightStore | undefined
  /** Identifiers of the lights that came from the source file, in cache order. */
  imported: readonly string[]
  engine: Engine
  /** A world's own move by name (`ExplorerSource.moveNamed`), taken before the engine's. */
  moveNamed?: (nodeName: string, matrix: Float32Array) => void
}

/** What the engine does with the contract's lights: it rereads the store at the next frame, so
 *  the lights and the view apply; its shadows and their limits it declares itself. */
function lightingOf(engine: Engine): LightingCapabilities {
  const { shadows, reason } = engine.lighting
  return reason ? { shadows, reason } : { shadows }
}

/** The reads of lights, the sky and what the engine does with them: detached copies, each call
 *  reading the store again. */
function lightReads(inputs: Inputs, required: () => SceneLightStore) {
  const { check, imported, engine } = inputs
  return {
    /**
     * Contract lights, in add order. Each one is a detached copy, arrays included: writing into
     * it changes nothing in the engine, and the next call reads the store again. The copy is
     * paid per call, by the host that calls; no frame reads this function.
     */
    lights(): SceneLight[] {
      check()
      const lights = required()
      return lights.ids.map((id) => cloneSceneLight(lights.light(id)!))
    },
    /**
     * Lights the scene file carried, declared at open, as the same detached copies. The host
     * reads them to set (`setLight`) or remove (`removeLight`) them; those it has already
     * removed are no longer there. A scene with no imported light yields an empty list, and
     * nothing has changed for it.
     */
    importedLights(): SceneLight[] {
      check()
      const lights = required()
      return imported.flatMap((id) => {
        const light = lights.light(id)
        return light ? [cloneSceneLight(light)] : []
      })
    },
    /** What the engine actually does with lights: a call accepted by the store is not proof of
     *  lighting, and its shadows and their limits are the engine's to declare. */
    lightingCapabilities() {
      check()
      return lightingOf(engine)
    },
  }
}

/** The writes of lights, view, environment and node poses: each one the engine takes at the
 *  next frame. */
function lightWrites(inputs: Inputs, required: () => SceneLightStore) {
  const { check, engine } = inputs
  const notify = () => engine.refreshSceneLights()
  return {
    setLightingView(view: SceneLightingView) {
      check()
      required().setView(view)
      notify()
    },
    addLight(light: SceneLight) {
      check()
      required().add(light)
      notify()
    },
    /** Hands the renderer the simple lights of the images to come (`SimpleLightEntry`): particle and effect lights the scene does not hold.
     *  The list replaces the one before it and lasts until another is given; one that holds what the last did changes nothing, and the held images stay. */
    setSimpleLights(entries: readonly SimpleLightEntry[]) {
      check()
      if (required().setSimpleLights(entries)) engine.refreshSimpleLights()
    },
    setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
      check()
      required().set(id, patch)
      notify()
    },
    removeLight(id: string) {
      check()
      required().remove(id)
      notify()
    },
    setEnvironment(environment: SceneEnvironment) {
      check()
      required().setEnvironment(environment)
      notify()
    },
    /** The sky module's resolved parts for the engine to draw — the sky light's capture, the clouds
     *  and their shadows —, none when the module is off (`Engine.applySky`). Takes effect at the next
     *  frame. */
    applySky(sky: ResolvedSky | undefined) {
      check()
      engine.applySky(sky)
    },
    setTransform(nodeName: string, matrix: Float32Array) {
      check()
      if (inputs.moveNamed) return inputs.moveNamed(nodeName, matrix)
      engine.setTransform(nodeName, matrix)
    },
    /** `setTransform` on many nodes the host resolved once: sixteen floats per node, in order. */
    setTransforms(nodes: readonly Object3D[], matrices: Float32Array) {
      check()
      engine.setTransforms(nodes, matrices)
    },
  }
}

/**
 * Public API of lights and environment. The store is the session's: the engine rereads it at the
 * next frame (`refreshSceneLights`).
 *
 * `setTransform` goes to the engine, which moves the node by its name. It draws
 * nothing: it marks the scene modified, and the next render — the host's `render()`, or the already
 * scheduled residency refresh — takes it. Ten poses set before a frame cost one submit, not
 * eleven: the frame gate refuses to hold the previous frame from the first pose, so the
 * screen never keeps a stale pose. `setTransforms` does the same for many nodes at once.
 */
export function createExplorerLightApi(inputs: Inputs) {
  const { store } = inputs
  const required = () => requiredStore(store, 'light')
  return {
    /** Published bounds of direct lighting, as the runtime applies them. */
    lightSettings: LIGHT_SETTINGS,
    /** Published bounds of bounced light: proxy threshold, grid, ray budget. */
    bounceSettings: BOUNCE_SETTINGS,
    ...lightReads(inputs, required),
    get environment(): SceneEnvironment | undefined {
      return store?.environment ? { ...store.environment } : undefined
    },
    /**
     * Requested view. `auto` — the starting value — yields the unlit view as long as no light
     * is declared, and real lighting as soon as there is one. `unlit` forces the raw-albedo
     * diagnostic view even with lights; `lit` forces real lighting, hence a black image in a
     * scene with no light — that is the rule, not a defect (P6). `bounce` is the measurement
     * view: indirect irradiance alone, in linear values multiplied by exposure.
     */
    get lightingView(): SceneLightingView {
      return store?.lightingView ?? 'auto'
    },
    ...lightWrites(inputs, required),
  }
}
