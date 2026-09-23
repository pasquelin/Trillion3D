import {
  BOUNCE_SETTINGS,
  EngineError,
  LIGHT_SETTINGS,
  type SceneEnvironment,
  type SceneLight,
  type SceneLightStore,
  type SceneLightingView,
  cloneSceneLight,
} from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic, RenderBackend } from '../../backend/types.ts';
import { lightingCapabilitiesOf } from '../../lighting/capabilities.ts';

type Inputs = {
  check: () => void;
  store: SceneLightStore | undefined;
  /** Identifiers of the lights that came from the source file, in cache order. */
  imported: readonly string[];
  backends: RenderBackend[];
  /** Active engine: it is its lighting capability that is published, not the session's. */
  active: () => RenderBackend;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
};

/**
 * Public API of lights and environment. The store is the session's: every engine shares it,
 * and an engine that does not know direct lighting ignores it without crashing —
 * `refreshSceneLights` is missing, its missing capability is declared in its diagnostic.
 *
 * `setTransform` goes to the active engine if it can move a node; otherwise the call is
 * refused by a named `EngineError`, never by an anonymous exception. It draws nothing: it
 * marks the scene modified, and the next render — the host's `render()`, or the already
 * scheduled residency refresh — takes it. Ten poses set before a frame cost one submit, not
 * eleven: the frame gate refuses to hold the previous frame from the first pose, so the
 * screen never keeps a stale pose.
 */
export function createExplorerLightApi(inputs: Inputs) {
  const { check, store, imported, backends, active, onDiagnostic } = inputs;
  // Once per session, not once per call: a host that sets its lights every frame would drown
  // its own diagnostic report under the same repeated finding.
  let warned = false;
  /**
   * The store accepts the light — it is the one that holds the contract, and the engine can
   * change afterwards — but the active engine will not apply it: the host learns it here,
   * by name, instead of inferring it from a black image.
   */
  const warnUnsupported = () => {
    if (warned) return;
    const capabilities = lightingCapabilitiesOf(active());
    if (capabilities.sceneLights) return;
    warned = true;
    onDiagnostic?.({
      phase: 'scene-lights-unsupported',
      message: capabilities.reason ?? 'the active engine does not apply the contract lights',
      context: { backend: active().id, capabilities },
    });
  };
  const required = () => {
    if (!store)
      throw new EngineError('SCENE_LIGHTS_UNAVAILABLE', 'session without a light store', {});
    return store;
  };
  const notify = () => {
    for (const backend of backends) backend.refreshSceneLights?.();
  };
  return {
    /** Published bounds of direct lighting, as the runtime applies them. */
    lightSettings: LIGHT_SETTINGS,
    /** Published bounds of bounced light: proxy threshold, grid, ray budget. */
    bounceSettings: BOUNCE_SETTINGS,
    /**
     * Contract lights, in add order. Each one is a detached copy, arrays included: writing into
     * it changes nothing in the engine, and the next call reads the store again. The copy is
     * paid per call, by the host that calls; no frame reads this function.
     */
    lights(): SceneLight[] {
      check();
      const lights = required();
      return lights.ids.map((id) => cloneSceneLight(lights.light(id)!));
    },
    /**
     * Lights the scene file carried, declared at open, as the same detached copies. The host
     * reads them to set (`setLight`) or remove (`removeLight`) them; those it has already
     * removed are no longer there. A scene with no imported light yields an empty list, and
     * nothing has changed for it.
     */
    importedLights(): SceneLight[] {
      check();
      const lights = required();
      return imported.flatMap((id) => {
        const light = lights.light(id);
        return light ? [cloneSceneLight(light)] : [];
      });
    },
    get environment(): SceneEnvironment | undefined {
      return store?.environment ? { ...store.environment } : undefined;
    },
    /**
     * Requested view. `auto` — the starting value — yields the unlit view as long as no light
     * is declared, and real lighting as soon as there is one. `unlit` forces the raw-albedo
     * diagnostic view even with lights; `lit` forces real lighting, hence a black image in a
     * scene with no light — that is the rule, not a defect (P6). `bounce` is the measurement
     * view: indirect irradiance alone, in linear values multiplied by exposure.
     */
    get lightingView(): SceneLightingView {
      return store?.lightingView ?? 'auto';
    },
    /**
     * What the ACTIVE engine actually does with lights: a call accepted by the store is not
     * proof of lighting. A host that wants to know whether its image changes reads it here,
     * before believing it; the answer follows the selected engine, not the session.
     */
    lightingCapabilities() {
      check();
      return lightingCapabilitiesOf(active());
    },
    setLightingView(view: SceneLightingView) {
      check();
      required().setView(view);
      warnUnsupported();
      notify();
    },
    addLight(light: SceneLight) {
      check();
      required().add(light);
      warnUnsupported();
      notify();
    },
    setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
      check();
      required().set(id, patch);
      warnUnsupported();
      notify();
    },
    removeLight(id: string) {
      check();
      required().remove(id);
      notify();
    },
    setEnvironment(environment: SceneEnvironment) {
      check();
      required().setEnvironment(environment);
      notify();
    },
    setTransform(nodeName: string, matrix: Float32Array) {
      check();
      let applied = 0;
      for (const backend of backends)
        if (backend.setTransform) {
          backend.setTransform(nodeName, matrix);
          applied++;
        }
      if (!applied)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          'no engine of this session moves a named node',
          { nodeName },
        );
    },
  };
}
