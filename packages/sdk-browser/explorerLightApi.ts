import {
  BOUNCE_SETTINGS,
  EngineError,
  LIGHT_SETTINGS,
  type SceneEnvironment,
  type SceneLight,
  type SceneLightStore,
  type SceneLightingView,
} from '../sdk-core/index.ts';
import type { BackendDiagnostic, RenderBackend } from './backendTypes.ts';
import { lightingCapabilitiesOf } from './lightingCapabilities.ts';

type Inputs = {
  check: () => void;
  store: SceneLightStore | undefined;
  /** Les identifiants des lampes venues du fichier source, dans l'ordre du cache. */
  imported: readonly string[];
  backends: RenderBackend[];
  /** Le moteur actif : c'est sa capacité d'éclairage qui est publiée, pas celle de la session. */
  active: () => RenderBackend;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
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
  const { check, store, imported, backends, active, onDiagnostic } = inputs;
  // Une fois par session, pas une fois par appel : un hôte qui pose ses lampes par image noierait
  // son propre rapport de diagnostic sous le même constat répété.
  let warned = false;
  /**
   * Le magasin accepte la lampe — c'est lui qui tient le contrat, et le moteur peut changer après —
   * mais le moteur actif ne l'appliquera pas : l'hôte l'apprend ici, nommément, au lieu de le
   * déduire d'une image noire.
   */
  const warnUnsupported = () => {
    if (warned) return;
    const capabilities = lightingCapabilitiesOf(active());
    if (capabilities.sceneLights) return;
    warned = true;
    onDiagnostic?.({
      phase: 'scene-lights-unsupported',
      message: capabilities.reason ?? "le moteur actif n'applique pas les lampes du contrat",
      context: { backend: active().id, capabilities },
    });
  };
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
    /**
     * Ce que le moteur ACTIF fait réellement des lampes : un appel accepté par le magasin n'est pas
     * une preuve d'éclairage. Un hôte qui veut savoir si son image change le lit ici, avant d'y
     * croire ; la réponse suit le moteur sélectionné, pas la session.
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
          'aucun moteur de cette session ne déplace un nœud nommé',
          { nodeName },
        );
    },
  };
}
