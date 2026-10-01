import type { LightingSceneLight, Vec3 } from './types.ts';

/** Most area panels a lighting scene holds. */
export const MAX_LIGHTING_PANELS = 16;
/** Emitted radiance of a panel of colour 1 and intensity 1 under a scene intensity of 1. */
export const LIGHTING_PANEL_RADIANCE = 12;

/** Independent copies for callers that animate individual controls. */
export function createDefaultLightingSceneLights(): LightingSceneLight[] {
  return [
    { id: 'warm', color: [1, 0.7, 0.45], intensity: 1, position: [-2.25, 2.96, 0] },
    { id: 'cyan', color: [0.03, 0.5, 1], intensity: 0.3, position: [2.5, 2.7, 1.2] },
    { id: 'magenta', color: [1, 0.05, 0.35], intensity: 0.2, position: [-2.8, 2.7, -1.8] },
  ];
}

/** The right room's eye: the mirrors turn its view towards the left room's red wall (`objects.ts`). */
export const LIGHTING_EYE: Vec3 = [2.8, 1.5, 2.5];

export function validateLightingSceneControls(
  doorAngle: number,
  lightIntensity: number,
  patchSize: number,
  roughness: number,
  options: { lights?: readonly LightingSceneLight[] },
): readonly LightingSceneLight[] {
  if (
    !Number.isFinite(doorAngle) ||
    !Number.isFinite(lightIntensity) ||
    lightIntensity < 0 ||
    !Number.isFinite(patchSize) ||
    patchSize <= 0 ||
    !Number.isFinite(roughness) ||
    roughness < 0 ||
    roughness > 1 ||
    !Number.isFinite(lightIntensity * LIGHTING_PANEL_RADIANCE)
  )
    throw new RangeError('Invalid lighting experiment parameters');
  const lights = options.lights ?? createDefaultLightingSceneLights();
  if (lights.length > MAX_LIGHTING_PANELS)
    throw new RangeError(`Lighting scene supports at most ${MAX_LIGHTING_PANELS} area panels`);
  const lightIds = new Set<string>();
  for (const light of lights) {
    if (
      typeof light.id !== 'string' ||
      !/^[a-z][a-z0-9_]*$/.test(light.id) ||
      lightIds.has(light.id) ||
      light.color.length !== 3 ||
      light.color.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      light.position.length !== 3 ||
      !light.position.every(Number.isFinite) ||
      !Number.isFinite(light.intensity) ||
      light.intensity < 0 ||
      !Number.isFinite(LIGHTING_PANEL_RADIANCE * light.intensity * lightIntensity)
    )
      throw new RangeError('Invalid lighting scene area panel');
    lightIds.add(light.id);
  }

  return lights;
}
