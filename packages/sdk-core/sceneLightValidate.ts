import { EngineError } from './cacheContracts.ts';
import type { SceneEnvironment, SceneLight } from './sceneLightContracts.ts';

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
/** La direction d'une lampe : trois nombres finis, rendus unitaires. Le tampon n'en voit pas d'autre. */
function direction(value: unknown, id: string): [number, number, number] {
  return normalized(vector(value, 'direction', id), id);
}
/** La direction d'un type qui en exige une : absente, la lampe est refusée avant tout calcul. */
function requiredDirection(value: unknown, id: string, why: string): [number, number, number] {
  if (value === undefined) throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${why}`, {});
  return direction(value, id);
}
/** Un champ qu'un type de lampe n'utilise pas est refusé, jamais accepté puis ignoré. */
function unused(
  light: SceneLight,
  field: 'position' | 'range' | 'coneAngle' | 'emitterRadius',
  why: string,
) {
  if (light[field] !== undefined)
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} ${why}`, { field });
}
/** La portée d'une ponctuelle ou d'un projecteur : strictement positive, en mètres. */
function range(value: unknown, id: string): number {
  if (!finite(value) || value <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: portée doit être > 0`, { range: value });
  return value;
}
/**
 * Le rayon de l'enveloppe qui porte la source, en mètres : strictement positif et strictement
 * inférieur à la portée. Une enveloppe aussi large que la portée ne laisserait sortir aucune ombre,
 * et le plan proche de la carte rejoindrait son plan lointain : le contrat le refuse au lieu de
 * rendre une carte dégénérée.
 */
function emitterRadius(value: unknown, range: number, id: string): number {
  if (!finite(value) || value <= 0 || value >= range)
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: rayon d'émetteur attendu dans (0, portée)`,
      { emitterRadius: value, range },
    );
  return value;
}
/** Le demi-angle du cône d'un projecteur, en radians, strictement dans `(0, π/2)`. */
function coneAngle(value: unknown, id: string): number {
  if (!finite(value) || value <= 0 || value >= Math.PI / 2)
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: demi-angle de cône attendu dans (0, π/2)`,
      {
        coneAngle: value,
      },
    );
  return value;
}
/**
 * Valide une lampe et en rend une copie normalisée. Une lampe refusée n'entre jamais dans le tampon :
 * le contrat n'accepte ni intensité négative, ni portée nulle, ni projecteur sans direction, ni
 * lampe directionnelle qui prétendrait avoir une position ou une portée.
 */
export function validateSceneLight(light: SceneLight): SceneLight {
  const id = light?.id;
  if (typeof id !== 'string' || !id.length)
    throw new EngineError('INVALID_SCENE_LIGHT', 'identifiant de lampe vide', { id });
  if (light.kind !== 'point' && light.kind !== 'spot' && light.kind !== 'directional')
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: type ${String(light.kind)} inconnu`, {
      kind: light.kind,
    });
  if (!finite(light.intensity) || light.intensity <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: intensité doit être > 0`, {
      intensity: light.intensity,
    });
  const color = vector(light.color, 'color', id);
  if (color.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: couleur négative`, { color });
  const validated: SceneLight = {
    id,
    kind: light.kind,
    color,
    intensity: light.intensity,
    castsShadow: !!light.castsShadow,
  };
  if (light.kind === 'directional') {
    unused(light, 'position', "n'existe pas pour une lampe directionnelle");
    unused(light, 'range', "n'existe pas pour une lampe directionnelle : elle porte partout");
    unused(light, 'coneAngle', "n'existe que pour un projecteur");
    unused(
      light,
      'emitterRadius',
      "n'existe pas pour une lampe directionnelle : elle n'a pas de position",
    );
    validated.direction = requiredDirection(
      light.direction,
      id,
      'une directionnelle exige sa direction',
    );
    return validated;
  }
  validated.position = vector(light.position, 'position', id);
  validated.range = range(light.range, id);
  if (light.emitterRadius !== undefined)
    validated.emitterRadius = emitterRadius(light.emitterRadius, validated.range, id);
  if (light.kind === 'spot') {
    validated.direction = requiredDirection(
      light.direction,
      id,
      'un projecteur exige une direction',
    );
    validated.coneAngle = coneAngle(light.coneAngle, id);
    return validated;
  }
  unused(light, 'coneAngle', "n'existe que pour un projecteur");
  if (light.direction !== undefined) validated.direction = direction(light.direction, id);
  return validated;
}
export function validateSceneEnvironment(environment: SceneEnvironment): SceneEnvironment {
  if (!finite(environment?.exposure) || environment.exposure <= 0)
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', 'exposition doit être > 0', {
      exposure: environment?.exposure,
    });
  return { exposure: environment.exposure };
}
