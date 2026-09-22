// The two published example pages whose cache carries a `clustered-blend` primitive, and so no
// `autonomousScene`: what each opens and what each lights it with, copied from the page itself
// (`site/examples/<page>.html`). Neither cache declares a light table, so a capture taken without
// these lights would be a black canvas on any backend and would prove nothing.
import type { SceneLight } from '../../packages/sdk-core/index.ts';

type BlendCacheScene = { page: string; asset: string; lights: SceneLight[] };

export const BLEND_CACHE_SCENES: BlendCacheScene[] = [
  {
    page: 'a-lamp-in-its-glass',
    asset: 'examples/lantern',
    lights: [
      {
        id: 'lamp',
        kind: 'point',
        position: [0, 2.4, 0],
        color: [1, 0.8, 0.5],
        intensity: 12,
        range: 10,
        emitterRadius: 0.34,
        castsShadow: true,
      },
    ],
  },
  {
    page: 'a-lighthouse-beam',
    asset: 'examples/lighthouse',
    lights: [
      {
        id: 'moon',
        kind: 'directional',
        direction: [0.4, -0.6, 0.7],
        color: [0.5, 0.6, 0.85],
        intensity: 0.5,
        castsShadow: true,
      },
      {
        id: 'beam',
        kind: 'spot',
        position: [0, 7.2, 0],
        direction: [1, -0.9, 0],
        coneAngle: 0.26,
        color: [1, 0.95, 0.8],
        intensity: 4000,
        range: 40,
        emitterRadius: 1.6,
        castsShadow: true,
      },
    ],
  },
];
