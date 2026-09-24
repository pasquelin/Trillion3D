import type { SceneLightStore } from '../../../sdk-core/src/index.ts';
import { DEFAULT_TONE_MAPPING } from '../../../sdk-core/src/scene/core/environment.ts';
import { DEFAULT_CLEAR_COLOR } from '../backend/common.ts';
import type { BackendContext } from '../backend/types.ts';
import { installSceneLighting, sceneLightingApi } from './sceneLighting.ts';
import { attachContractLights, CONTRACT_LIGHTS_LIGHTING } from './contractLights.ts';
import { Color } from '../../../sdk-core/src/world/math/color.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

/** The render scene the contract writes into. */
type RenderScene = Parameters<typeof attachContractLights>[0];

/** The clear colour a WebGL2 engine's graph carries, the one its draw clears with: written in
 *  place once a colour is there, nothing allocated. */
const paint = (scene: RenderScene, clearColor: number) => {
  if (scene.background) scene.background.setHex(clearColor);
  else scene.background = new Color().setHex(clearColor);
};

/** What sets that colour during the session, then tells `changed` the held frame is stale: the
 *  engine's resource revision, never its scene one — nothing else is walked again. */
export const graphBackground = (scene: RenderScene, changed: () => void) => (hex: number) => {
  paint(scene, hex);
  changed();
};

/** The display graph a WebGL2 engine draws: its clear colour, then the source-graph lights
 *  copied onto it, each aiming at an empty node of the same graph. */
export function installLighting(scene: RenderScene, clearColor: number, source: Object3D) {
  paint(scene, clearColor);
  return installSceneLighting(scene, source, () => new Object3D());
}

/**
 * The lighting half of a WebGL2 engine's API, in one place: the source graph's own
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
    /** The display curve the scene chose through its environment; ACES when it chose none. */
    sceneToneMapping: () => store?.environment?.toneMapping ?? DEFAULT_TONE_MAPPING,
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
