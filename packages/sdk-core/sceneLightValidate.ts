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
/** Un champ qu'un type de lampe n'utilise pas est refusé, jamais accepté puis ignoré. */
function unused(light: SceneLight, field: 'position' | 'range' | 'coneAngle', why: string) {
  if (light[field] !== undefined)
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} ${why}`, { field });
}
/** La portée d'une ponctuelle ou d'un projecteur : strictement positive, en mètres. */
function range(light: SceneLight): number {
  if (!finite(light.range) || light.range! <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: portée doit être > 0`, {
      range: light.range,
    });
  return light.range!;
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
    if (light.direction === undefined)
      throw new EngineError(
        'INVALID_SCENE_LIGHT',
        `${id}: une directionnelle exige sa direction`,
        {},
      );
    validated.direction = normalized(vector(light.direction, 'direction', id), id);
    return validated;
  }
  validated.position = vector(light.position, 'position', id);
  validated.range = range(light);
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
    return validated;
  }
  unused(light, 'coneAngle', "n'existe que pour un projecteur");
  if (light.direction !== undefined)
    validated.direction = normalized(vector(light.direction, 'direction', id), id);
  return validated;
}
export function validateSceneEnvironment(environment: SceneEnvironment): SceneEnvironment {
  if (!finite(environment?.exposure) || environment.exposure <= 0)
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', 'exposition doit être > 0', {
      exposure: environment?.exposure,
    });
  return { exposure: environment.exposure };
}
