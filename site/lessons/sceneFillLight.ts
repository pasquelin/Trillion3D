import type { Explorer } from '../../packages/sdk-browser/index.ts';
import type { SceneLight } from '../../packages/sdk/index.ts';

const SCENE_FILL_LIGHT: SceneLight = {
  id: 'scene-fill',
  kind: 'directional',
  direction: [0.45, -0.35, 0.8],
  color: [0.55, 0.68, 1],
  intensity: 0.6,
  castsShadow: false,
};

export const addSceneFillLight = (explorer: Explorer) => explorer.addLight(SCENE_FILL_LIGHT);

export const sceneFillLightCode = () =>
  `explorer.addLight({ id: 'scene-fill', kind: 'directional', direction: [0.45, -0.35, 0.8], color: [0.55, 0.68, 1], intensity: 0.6, castsShadow: false });`;
