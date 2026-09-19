import type { LightingCapabilities } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';

/**
 * What the active engine actually does with the contract's lights.
 *
 * Two fields are read off the engine itself and therefore cannot lie: it rereads the store if it
 * carries `refreshSceneLights`, it moves a named node if it carries `setTransform`. An engine that
 * does not reread the store has no lighting view either: `setLightingView` would change nothing in
 * its frame. What no signature says — shadows — an engine declares itself.
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
      : `${backend.id} does not apply the contract's lights: the store accepts them, the frame does not change`);
  if (reason) capabilities.reason = reason;
  return capabilities;
}
