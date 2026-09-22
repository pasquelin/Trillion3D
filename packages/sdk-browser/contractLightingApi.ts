import type { SceneLightStore } from '../sdk-core/index.ts';
import { DEFAULT_CLEAR_COLOR, lighting as installLighting } from './backendCommon.ts';
import type { BackendContext } from './backendTypes.ts';
import { sceneLightingApi, type installSceneLighting } from './sceneLighting.ts';
import { attachContractLights, CONTRACT_LIGHTS_LIGHTING } from './exactPagesContractLights.ts';

/** The render scene the contract writes into, named without importing the host library here. */
type RenderScene = Parameters<typeof attachContractLights>[0];
/**
 * The lighting half of a Three-rendered engine's API, in one place: the source graph's own
 * lights while the contract declares none, the contract's — radiometric, as the cache's light
 * table records them — as soon as it does. An engine that skips this draws the glTF's
 * photometric intensities straight into the renderer and blows its image out to white.
 */
export function contractLightingApi(
  scene: RenderScene,
  store: SceneLightStore | undefined,
  source: ReturnType<typeof installSceneLighting>,
  sceneChanged: () => void,
) {
  const contract = attachContractLights(scene, store, source, sceneChanged);
  return {
    ...sceneLightingApi(source, sceneChanged),
    /** The image comes out in real light as soon as either light set carries one. */
    sceneLit: () => contract.lit,
    refreshSceneLights: contract.apply,
    lighting: CONTRACT_LIGHTS_LIGHTING,
  };
}

/**
 * Both halves at once, for an engine that holds no other use for the source-graph lights: the
 * copy installed on its scene, and the API above wired onto it.
 */
export function createContractLighting(
  scene: RenderScene,
  context: BackendContext,
  sceneChanged: () => void,
) {
  const source = installLighting(
    scene,
    context.clearColor ?? DEFAULT_CLEAR_COLOR,
    context.sceneLighting ?? context.source,
  );
  return {
    lighting: source,
    api: contractLightingApi(scene, context.sceneLights, source, sceneChanged),
  };
}
