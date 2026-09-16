import type { LightingCapabilities } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';

/**
 * Ce que le moteur actif fait réellement des lampes du contrat.
 *
 * Deux champs se lisent dans le moteur lui-même et ne peuvent donc pas mentir : il relit le magasin
 * s'il porte `refreshSceneLights`, il déplace un nœud nommé s'il porte `setTransform`. Un moteur qui
 * ne relit pas le magasin n'a pas non plus de vue d'éclairage : `setLightingView` ne changerait rien
 * à son image. Reste ce qu'aucune signature ne dit — les ombres —, qu'un moteur déclare lui-même.
 */
export function lightingCapabilitiesOf(backend: RenderBackend): LightingCapabilities {
  const sceneLights = !!backend.refreshSceneLights;
  const declared = backend.lighting;
  const capabilities: LightingCapabilities = {
    sceneLights,
    lightingView: sceneLights,
    shadows: sceneLights && declared?.shadows === true,
    transforms: !!backend.setTransform,
  };
  const reason =
    declared?.reason ??
    (sceneLights
      ? undefined
      : `${backend.id} n'applique pas les lampes du contrat : le magasin les accepte, l'image ne change pas`);
  if (reason) capabilities.reason = reason;
  return capabilities;
}
