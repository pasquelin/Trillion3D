import { EngineError } from './cacheContracts.ts';

/**
 * Une lampe de scène, version 1. Les unités sont radiométriques et linéaires (P1) : `color` est une
 * couleur linéaire, `intensity` une intensité radiométrique strictement positive, `range` la portée
 * en mètres au-delà de laquelle la lampe n'éclaire plus rien. `direction` et `coneAngle` n'existent
 * que pour un projecteur ; `coneAngle` est le demi-angle en radians.
 */
export interface SceneLight {
  id: string;
  kind: 'point' | 'spot';
  position: [number, number, number];
  direction?: [number, number, number];
  color: [number, number, number];
  intensity: number;
  range: number;
  coneAngle?: number;
  castsShadow: boolean;
}
/** Le ciel comme terme ambiant constant et l'exposition appliquée avant ACES (P4). */
export interface SceneEnvironment {
  skyColor: [number, number, number];
  exposure: number;
}
export const SCENE_LIGHT_VERSION = 1;
/**
 * Réglages publiés de l'éclairage direct. Ce sont des choix de produit nommés, pas des constantes
 * enfouies : chaque borne du runtime les relit, et le diagnostic les publie telles quelles.
 */
export const LIGHT_SETTINGS = {
  /** Lampes que le contrat accepte au total ; au-delà, `addLight` refuse. */
  maxLights: 64,
  /** Lampes qu'une tuile d'écran retient ; la boucle du pixel est bornée par ce nombre (X2). */
  maxLightsPerTile: 32,
  /** Côté en pixels d'une tuile d'écran de la liste de lampes. */
  tileSize: 16,
  /** Lampes à ombre remises à jour par image, les plus prioritaires (X5). */
  shadowUpdatesPerFrame: 4,
  /** Côté de l'atlas d'ombres de profondeur, en texels. */
  shadowAtlasSize: 4096,
  /** Côté maximal d'une tranche d'ombre ; une face de ponctuelle en occupe un sixième d'aire. */
  shadowSliceMax: 1024,
  /** Côté minimal d'une tranche d'ombre : en dessous, la lampe garde sa tranche sans la raffiner. */
  shadowSliceMin: 128,
  /** Prises de PCF par pixel et par lampe à ombre (X2). */
  pcfTaps: 16,
  /** Largeur du bord adouci du cône d'un projecteur, en unités de cosinus : contre l'escalier. */
  spotEdgeSoftness: 0.02,
  /**
   * Biais d'ombre en mètres, jamais en unités de profondeur : la profondeur projetée d'une tranche
   * est très non linéaire, une constante en profondeur normalisée vaudrait des mètres près de la
   * lampe et des millimètres au loin. Le shader ramène ces mètres en profondeur au point considéré.
   */
  shadowDepthBias: 0.02,
  /** Biais par pente, en mètres par unité de `tan(acos(N·L))`, plafonné par `shadowSlopeBiasMax`. */
  shadowSlopeBias: 0.08,
  shadowSlopeBiasMax: 0.5,
  /** Plan proche d'une tranche : une fraction de la portée, jamais moins que ce plancher. */
  shadowNearFraction: 1 / 200,
  shadowNearMin: 0.05,
  /**
   * Décalage du point de lecture le long de la normale, en texels de la tranche. C'est lui qui
   * referme la couture entre deux faces d'une ponctuelle et qui supprime l'acné rasante ; il est en
   * texels et non en mètres pour rester proportionnel à la résolution que la lampe a obtenue.
   */
  shadowNormalOffsetTexels: 1.5,
} as const;
/** Lampes qu'une tranche d'ombre peut adresser dans l'atlas : une par lampe à ombre déclarée. */
export const MAX_SHADOW_SLICES = LIGHT_SETTINGS.maxLights;
/** Faces d'une tranche : six pour une ponctuelle, une pour un projecteur. */
export const POINT_FACES = 6;
/** Flottants d'une lampe dans le tampon GPU : quatre `vec4f`, jamais réalloués. */
export const SCENE_LIGHT_FLOATS = 16;
/** Entête du tampon de lampes : compte, tuiles en X, tuiles en Y, mode. */
export const SCENE_LIGHT_HEADER_FLOATS = 4;
export const SCENE_LIGHT_BUFFER_FLOATS =
  SCENE_LIGHT_HEADER_FLOATS + LIGHT_SETTINGS.maxLights * SCENE_LIGHT_FLOATS;
/** Le mode d'éclairage direct que l'hôte a choisi, publié tel quel dans le diagnostic. */
export type SceneLightMode = 'authored' | 'contract';

const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value);
function vector(value: unknown, field: string, id: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${field} attend trois nombres finis`, {
      field,
      value,
    });
  return [value[0], value[1], value[2]];
}
function normalized(value: [number, number, number], id: string): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 1e-6))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: direction de longueur nulle`, { value });
  return [value[0] / length, value[1] / length, value[2] / length];
}
/**
 * Valide une lampe et en rend une copie normalisée. Une lampe refusée n'entre jamais dans le tampon :
 * le contrat n'accepte ni intensité négative, ni portée nulle, ni projecteur sans direction.
 */
export function validateSceneLight(light: SceneLight): SceneLight {
  const id = light?.id;
  if (typeof id !== 'string' || !id.length)
    throw new EngineError('INVALID_SCENE_LIGHT', 'identifiant de lampe vide', { id });
  if (light.kind !== 'point' && light.kind !== 'spot')
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: type ${String(light.kind)} inconnu`, {
      kind: light.kind,
    });
  if (!finite(light.intensity) || light.intensity <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: intensité doit être > 0`, {
      intensity: light.intensity,
    });
  if (!finite(light.range) || light.range <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: portée doit être > 0`, {
      range: light.range,
    });
  const color = vector(light.color, 'color', id);
  if (color.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: couleur négative`, { color });
  const validated: SceneLight = {
    id,
    kind: light.kind,
    position: vector(light.position, 'position', id),
    color,
    intensity: light.intensity,
    range: light.range,
    castsShadow: !!light.castsShadow,
  };
  if (light.kind === 'spot') {
    if (light.direction === undefined)
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: un projecteur exige une direction`, {});
    if (!finite(light.coneAngle) || light.coneAngle! <= 0 || light.coneAngle! >= Math.PI / 2)
      throw new EngineError(
        'INVALID_SCENE_LIGHT',
        `${id}: demi-angle de cône attendu dans (0, π/2)`,
        { coneAngle: light.coneAngle },
      );
    validated.direction = normalized(vector(light.direction, 'direction', id), id);
    validated.coneAngle = light.coneAngle;
  } else if (light.direction !== undefined)
    validated.direction = normalized(vector(light.direction, 'direction', id), id);
  return validated;
}
export function validateSceneEnvironment(environment: SceneEnvironment): SceneEnvironment {
  const skyColor = vector(environment?.skyColor, 'skyColor', 'environment');
  if (skyColor.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', 'couleur de ciel négative', { skyColor });
  if (!finite(environment.exposure) || environment.exposure <= 0)
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', 'exposition doit être > 0', {
      exposure: environment.exposure,
    });
  return { skyColor, exposure: environment.exposure };
}
