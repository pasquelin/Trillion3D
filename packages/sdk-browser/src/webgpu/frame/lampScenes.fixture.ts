import type { SceneLight } from '../../../../sdk-core/src/index.ts';

const POINT: SceneLight = {
  id: 'lamp',
  kind: 'point',
  position: [0, 2.5, 0],
  color: [1, 0.5, 0.2],
  intensity: 14,
  range: 6,
  castsShadow: false,
};
const lamps = (count: number, castsShadow: boolean) =>
  Array.from({ length: count }, (_, at) => ({ ...POINT, id: `lamp${at}`, castsShadow }));

/** The lights of the shipped lamp examples (`site/examples/`). */
export const LAMP_SCENES: Record<string, SceneLight[]> = {
  'a-lighthouse-beam': [
    {
      id: 'moon',
      kind: 'directional',
      direction: [0.5, -0.7, -0.5],
      color: [0.5, 0.6, 0.85],
      intensity: 2,
      castsShadow: true,
    },
    {
      id: 'beam',
      kind: 'spot',
      position: [0, 7.1, 0],
      direction: [1, -0.2, 0],
      color: [1, 0.95, 0.8],
      intensity: 6000,
      range: 60,
      coneAngle: 0.12,
      penumbra: 0.3,
      castsShadow: false,
    },
  ],
  'a-ring-of-lamps': lamps(32, false),
  'a-ring-of-lamps, shadows on': lamps(32, true),
};
