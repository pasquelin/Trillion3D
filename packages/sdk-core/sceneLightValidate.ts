import { EngineError } from './cacheContracts.ts';
import type { SceneEnvironment, SceneLight } from './sceneLightContracts.ts';

const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value);
function vector(value: unknown, field: string, id: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${field} expects three finite numbers`, {
      field,
      value,
    });
  return [value[0], value[1], value[2]];
}
function normalized(value: [number, number, number], id: string): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 1e-6))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: zero-length direction`, { value });
  return [value[0] / length, value[1] / length, value[2] / length];
}
/** A light's direction: three finite numbers, returned unit. The buffer sees no other. */
function direction(value: unknown, id: string): [number, number, number] {
  return normalized(vector(value, 'direction', id), id);
}
/** Direction of a type that requires one: if missing, the light is rejected before any calculation. */
function requiredDirection(value: unknown, id: string, why: string): [number, number, number] {
  if (value === undefined) throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${why}`, {});
  return direction(value, id);
}
/** A field a light type does not use is rejected, never accepted then ignored. */
function unused(
  light: SceneLight,
  field: 'position' | 'range' | 'coneAngle' | 'emitterRadius',
  why: string,
) {
  if (light[field] !== undefined)
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} ${why}`, { field });
}
/** Range of a point or spot: strictly positive, in metres. */
function range(value: unknown, id: string): number {
  if (!finite(value) || value <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: range must be > 0`, { range: value });
  return value;
}
/**
 * Radius of the envelope that holds the source, in metres: strictly positive and strictly
 * less than the range. An envelope as wide as the range would let no shadow out,
 * and the map near plane would meet its far plane: the contract rejects it instead of
 * returning a degenerate map.
 */
function emitterRadius(value: unknown, range: number, id: string): number {
  if (!finite(value) || value <= 0 || value >= range)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: emitter radius expected in (0, range)`, {
      emitterRadius: value,
      range,
    });
  return value;
}
/** Half-angle of a spot cone, in radians, strictly in `(0, π/2)`. */
function coneAngle(value: unknown, id: string): number {
  if (!finite(value) || value <= 0 || value >= Math.PI / 2)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: cone half-angle expected in (0, π/2)`, {
      coneAngle: value,
    });
  return value;
}
/**
 * Validates a light and returns a normalised copy. A rejected light never enters the buffer:
 * the contract accepts neither negative intensity, nor zero range, nor a spot without direction, nor
 * a directional light that would claim a position or a range.
 */
export function validateSceneLight(light: SceneLight): SceneLight {
  const id = light?.id;
  if (typeof id !== 'string' || !id.length)
    throw new EngineError('INVALID_SCENE_LIGHT', 'empty light identifier', { id });
  if (light.kind !== 'point' && light.kind !== 'spot' && light.kind !== 'directional')
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: unknown type ${String(light.kind)}`, {
      kind: light.kind,
    });
  if (!finite(light.intensity) || light.intensity <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: intensity must be > 0`, {
      intensity: light.intensity,
    });
  const color = vector(light.color, 'color', id);
  if (color.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: negative colour`, { color });
  const validated: SceneLight = {
    id,
    kind: light.kind,
    color,
    intensity: light.intensity,
    castsShadow: !!light.castsShadow,
  };
  if (light.kind === 'directional') {
    unused(light, 'position', 'does not exist for a directional light');
    unused(light, 'range', 'does not exist for a directional light: it carries everywhere');
    unused(light, 'coneAngle', 'exists only for a spot');
    unused(light, 'emitterRadius', 'does not exist for a directional light: it has no position');
    validated.direction = requiredDirection(
      light.direction,
      id,
      'a directional requires its direction',
    );
    return validated;
  }
  validated.position = vector(light.position, 'position', id);
  validated.range = range(light.range, id);
  if (light.emitterRadius !== undefined)
    validated.emitterRadius = emitterRadius(light.emitterRadius, validated.range, id);
  if (light.kind === 'spot') {
    validated.direction = requiredDirection(light.direction, id, 'a spot requires a direction');
    validated.coneAngle = coneAngle(light.coneAngle, id);
    return validated;
  }
  unused(light, 'coneAngle', 'exists only for a spot');
  if (light.direction !== undefined) validated.direction = direction(light.direction, id);
  return validated;
}
export function validateSceneEnvironment(environment: SceneEnvironment): SceneEnvironment {
  if (!finite(environment?.exposure) || environment.exposure <= 0)
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', 'exposure must be > 0', {
      exposure: environment?.exposure,
    });
  return { exposure: environment.exposure };
}
