import {
  BOUNCE_SETTINGS,
  EngineError,
  LIGHT_SETTINGS,
  type SceneEnvironment,
  type SceneLight,
  type SceneLightStore,
  type SceneLightingView,
} from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';

type Inputs = {
  check: () => void;
  store: SceneLightStore | undefined;
  /** Les identifiants des lampes venues du fichier source, dans l'ordre du cache. */
  imported: readonly string[];
  backends: RenderBackend[];
};

/**
 * L'API publique des lampes et de l'environnement. Le magasin est celui de la session : tous les
 * moteurs le partagent, et un moteur qui ne sait pas l'éclairage direct l'ignore sans planter —
 * `refreshSceneLights` lui manque, sa capacité manquante est déclarée dans son diagnostic.
 *
 * `setTransform` va au moteur actif s'il sait déplacer un nœud ; sinon l'appel est refusé par un
 * `EngineError` nommé, jamais par une exception anonyme. Il ne dessine rien : il marque la scène
 * modifiée, et le rendu suivant — le `render()` de l'hôte, ou le rafraîchissement de résidence déjà
 * planifié — la prend. Dix poses posées avant une image coûtent une soumission, pas onze : la porte
 * d'image refuse de tenir l'image précédente dès la première pose, l'écran ne garde donc jamais une
 * pose périmée.
 */
export function createExplorerLightApi(inputs: Inputs) {
  const { check, store, imported, backends } = inputs;
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
    /** Les bornes publiées de la lumière qui rebondit : seuil du proxy, grille, budget de rayons. */
    bounceSettings: BOUNCE_SETTINGS,
    /** Les lampes du contrat, dans l'ordre d'ajout ; une copie de lecture, jamais le tampon. */
    lights(): SceneLight[] {
      check();
      const lights = required();
      return lights.ids.map((id) => ({ ...lights.light(id)! }));
    },
    /**
     * Les lampes que le fichier de scène portait, déclarées à l'ouverture. L'hôte les lit pour les
     * régler (`setLight`) ou les retirer (`removeLight`) ; celles qu'il a déjà retirées n'y sont
     * plus. Une scène sans lampe importée en rend une liste vide, et rien n'a changé pour elle.
     */
    importedLights(): SceneLight[] {
      check();
      const lights = required();
      return imported.flatMap((id) => {
        const light = lights.light(id);
        return light ? [{ ...light }] : [];
      });
    },
    get environment(): SceneEnvironment | undefined {
      return store?.environment ? { ...store.environment } : undefined;
    },
    /**
     * La vue demandée. `auto` — la valeur de départ — rend la vue sans éclairage tant qu'aucune
     * lampe n'est déclarée, et l'éclairage réel dès qu'il y en a une. `unlit` force la vue de
     * diagnostic d'albédo brut même avec des lampes ; `lit` force l'éclairage réel, donc une image
     * noire dans une scène sans lampe — c'est la règle, pas un défaut (P6). `bounce` est la vue de
     * mesure : l'irradiance indirecte seule, en valeurs linéaires multipliées par l'exposition.
     */
    get lightingView(): SceneLightingView {
      return store?.lightingView ?? 'auto';
    },
    setLightingView(view: SceneLightingView) {
      check();
      required().setView(view);
      notify();
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
    },
  };
}
