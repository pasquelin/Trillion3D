import * as THREE from 'three';
import { LIGHT_SETTINGS, type SceneLight, type SceneLightStore } from '../sdk-core/index.ts';
import { baseCapabilities } from './backendCommon.ts';

/** Un moteur rendu par Three applique les lampes du contrat ; seules leurs ombres lui manquent —
 *  Three n'en fournirait qu'au prix d'une carte par lampe, six faces pour une ponctuelle, hors
 *  budget d'image. Les deux constantes disent cela dans les capacités publiées par le moteur. */
export const CONTRACT_LIGHTS_LIGHTING = {
  shadows: false,
  reason: "lampes du contrat sans ombre portée ; la vue 'bounce' y vaut la vue éclairée",
};
const RETIRES = ['bounded GPU eviction', 'contract scene lights with shadow atlas'];
export const CONTRACT_LIGHTS_UNSUPPORTED = baseCapabilities.unsupported
  .filter((item) => !RETIRES.includes(item))
  .concat('contract scene light shadows');

/**
 * Albédo brut par la lumière, et non par les matériaux : un matériau standard rend
 * `irradiance · albédo / π` en diffus, donc une irradiance ambiante de π rend exactement l'albédo.
 * C'est la vue `unlit` du contrat obtenue sans toucher à un seul matériau de la scène — donc sans
 * lui inventer une seconde version qui pourrait diverger de celle que l'image éclairée montre.
 */
const UNLIT_IRRADIANCE = Math.PI;
/** Distance de l'œil d'une directionnelle : elle n'a pas de position, seule sa direction compte. */
const SUN_DISTANCE = 1;

/** Conversion de la couleur linéaire du contrat, sans passer par sRGB : c'est l'espace de travail. */
function applyColor(light: THREE.Light, source: SceneLight) {
  light.color.setRGB(source.color[0], source.color[1], source.color[2]);
  light.intensity = source.intensity;
}

/**
 * Le demi-angle de pénombre qui reproduit le bord de cône du contrat. Le chemin WebGPU adoucit le
 * cône entre `cos(demi-angle)` et `cos(demi-angle) + spotEdgeSoftness` ; Three adoucit entre
 * `cos(angle)` et `cos(angle · (1 − penumbra))`. Égaler les deux cosinus donne cette pénombre — la
 * même transition, pas une transition voisine.
 */
function spotPenumbra(coneAngle: number) {
  const inner = Math.acos(Math.min(1, Math.cos(coneAngle) + LIGHT_SETTINGS.spotEdgeSoftness));
  return Math.min(1, Math.max(0, 1 - inner / coneAngle));
}

/** Une lampe Three neuve du type demandé, avec sa cible quand elle en a une. */
function createLight(source: SceneLight): THREE.Light {
  if (source.kind === 'point') return new THREE.PointLight();
  if (source.kind === 'spot') return new THREE.SpotLight();
  return new THREE.DirectionalLight();
}

/**
 * Écrit une lampe du contrat dans sa lampe Three. Les unités sont celles du contrat, sans facteur
 * d'ajustement : `intensity` est une intensité radiométrique en W/sr pour une ponctuelle ou un
 * projecteur, et Three avec `decay = 2` et `distance = range` applique exactement l'atténuation du
 * shader d'éclairage différé — `pow(clamp(1 − (d/range)⁴, 0, 1), 2) / d²`, terme pour terme. Une
 * directionnelle porte une irradiance, la même partout, et Three en fait autant.
 *
 * Ce qui n'est pas égalisé et ne prétend pas l'être : le modèle de surface. Three évalue un
 * Cook-Torrance de son cru, le chemin WebGPU le sien ; l'irradiance incidente est la même, l'image
 * ne l'est pas. Aucune ombre non plus — voir `shadows: false` dans les capacités du moteur.
 */
function writeLight(light: THREE.Light, source: SceneLight) {
  applyColor(light, source);
  if (source.kind === 'directional') {
    const direction = source.direction!;
    light.position.set(
      -direction[0] * SUN_DISTANCE,
      -direction[1] * SUN_DISTANCE,
      -direction[2] * SUN_DISTANCE,
    );
    (light as THREE.DirectionalLight).target.position.set(0, 0, 0);
    return;
  }
  const position = source.position!;
  light.position.set(position[0], position[1], position[2]);
  const punctual = light as THREE.PointLight;
  punctual.distance = source.range!;
  punctual.decay = 2;
  if (source.kind !== 'spot') return;
  const spot = light as THREE.SpotLight;
  spot.angle = source.coneAngle!;
  spot.penumbra = spotPenumbra(source.coneAngle!);
  const direction = source.direction!;
  spot.target.position.set(
    position[0] + direction[0],
    position[1] + direction[1],
    position[2] + direction[2],
  );
}

/**
 * Relie le magasin de lampes du contrat aux lampes affichées par un moteur rendu par Three.
 *
 * Le contrat ne prend la main que lorsque l'hôte s'en est servi — une lampe déclarée, ou une vue
 * demandée. Tant qu'il ne l'a pas fait, les lampes du graphe source restent seules à éclairer et
 * l'image est celle d'avant ce lot, au pixel près. Dès qu'il l'a fait, le graphe source s'efface :
 * deux jeux de lampes superposés ne seraient l'éclairage de personne.
 */
function createContractLights(scene: THREE.Scene, store: SceneLightStore | undefined) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const ambient = new THREE.AmbientLight(0xffffff, UNLIT_IRRADIANCE);
  ambient.visible = false;
  group.add(ambient);
  // Le type de la lampe est retenu à côté d'elle : régler une ponctuelle en projecteur change
  // l'objet Three, et comparer des chaînes de type coûterait une allocation par lampe et par passe.
  const lights = new Map<string, { light: THREE.Light; kind: SceneLight['kind'] }>();
  let epoch = -1,
    governs = false;
  const drop = (id: string) => {
    const entry = lights.get(id)!;
    group.remove(entry.light);
    if ('target' in entry.light) group.remove((entry.light as THREE.DirectionalLight).target);
    entry.light.dispose();
    lights.delete(id);
  };
  const dropAll = () => {
    for (const id of [...lights.keys()]) drop(id);
  };
  const rebuild = () => {
    const ids = new Set(store!.ids);
    for (const [id, entry] of [...lights])
      if (!ids.has(id) || store!.light(id)!.kind !== entry.kind) drop(id);
    for (const id of store!.ids) {
      const source = store!.light(id)!;
      let entry = lights.get(id);
      if (!entry) {
        entry = { light: createLight(source), kind: source.kind };
        lights.set(id, entry);
        group.add(entry.light);
        if ('target' in entry.light) group.add((entry.light as THREE.DirectionalLight).target);
      }
      writeLight(entry.light, source);
    }
  };
  return {
    /**
     * Rend vrai quand le contrat gouverne désormais l'éclairage — l'appelant doit alors cesser de
     * rafraîchir les lampes du graphe source. Ne fait rien tant que le magasin n'a pas changé.
     */
    refresh() {
      if (!store) return false;
      const wanted = store.count > 0 || store.lightingView !== 'auto';
      if (!wanted) {
        if (governs) dropAll();
        governs = false;
        group.visible = false;
        epoch = store.epoch;
        return false;
      }
      governs = true;
      group.visible = true;
      if (epoch === store.epoch) return true;
      epoch = store.epoch;
      // `unlit` — demandée, ou `auto` sans lampe — ne montre aucune lampe : l'ambiance rend l'albédo.
      ambient.visible = store.unlit;
      if (store.unlit) dropAll();
      else rebuild();
      return true;
    },
    /** Vrai quand l'image sort en lumière réelle : la composition passe alors par ACES (P6). */
    get lit() {
      return governs && !!store && !store.unlit;
    },
    /** Vrai quand le contrat a pris la main sur les lampes du graphe source. */
    get governs() {
      return governs;
    },
  };
}

/**
 * Branche le contrat sur un moteur rendu par Three et rend de quoi le tenir : `apply` à chaque
 * révision du magasin, `lit` à chaque image. Les lampes importées sont déclarées avant que le moteur
 * existe, donc la première passe a lieu ici même, à la construction.
 */
export function attachContractLights(
  scene: THREE.Scene,
  store: SceneLightStore | undefined,
  source: { setEnabled(enabled: boolean): void; readonly lit: boolean },
  sceneChanged: () => void,
) {
  const contract = createContractLights(scene, store);
  const apply = () => {
    source.setEnabled(!contract.refresh());
    sceneChanged();
  };
  apply();
  return {
    apply,
    get lit() {
      return contract.lit || source.lit;
    },
  };
}
