import {
  EngineError,
  LIGHT_SETTINGS,
  type SceneEnvironment,
  type SceneLight,
  type SceneLightStore,
} from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';

type Inputs = {
  check: () => void;
  store: SceneLightStore | undefined;
  backends: RenderBackend[];
};

/**
 * L'API publique des lampes et de l'environnement. Le magasin est celui de la session : tous les
 * moteurs le partagent, et un moteur qui ne sait pas l'éclairage direct l'ignore sans planter —
 * `refreshSceneLights` lui manque, sa capacité manquante est déclarée dans son diagnostic.
 *
 * `setTransform` va au moteur actif s'il sait déplacer un nœud ; sinon l'appel est refusé par un
 * `EngineError` nommé, jamais par une exception anonyme.
 */
export function createExplorerLightApi(inputs: Inputs) {
  const { check, store, backends } = inputs;
  const required = () => {
    if (!store)
      throw new EngineError('SCENE_LIGHTS_UNAVAILABLE', 'session sans magasin de lampes', {});
    return store;
  };
  const notify = () => {
    for (const backend of backends) backend.refreshSceneLights?.();
  };
  return {
    /** Les bornes publiées de l'éclairage direct, telles que le runtime les applique. */
    lightSettings: LIGHT_SETTINGS,
    /** Les lampes du contrat, dans l'ordre d'ajout ; une copie de lecture, jamais le tampon. */
    lights(): SceneLight[] {
      check();
      const lights = required();
      return lights.ids.map((id) => ({ ...lights.light(id)! }));
    },
    get environment(): SceneEnvironment | undefined {
      return store?.environment ? { ...store.environment } : undefined;
    },
    addLight(light: SceneLight) {
      check();
      required().add(light);
      notify();
    },
    setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
      check();
      required().set(id, patch);
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
          'aucun moteur de cette session ne déplace un nœud nommé',
          { nodeName },
        );
      for (const backend of backends) backend.syncResident?.();
    },
  };
}
