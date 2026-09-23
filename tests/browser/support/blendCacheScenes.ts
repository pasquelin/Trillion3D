// The public test scene whose cache carries a `clustered-blend` primitive, and so no
// `autonomousScene` (`.mesure/assets/`, off git: `bench/runner/README.md` § Assets), with the light
// the proof sets on it. The cache declares no light table, so a capture taken without one would be
// a black canvas on any backend and would prove nothing: the bench sun, the same for any model.
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts';
import { SUN } from '../../../bench/runner/lamps.ts';

type BlendCacheScene = { name: string; lights: SceneLight[] };

export const BLEND_CACHE_SCENES: BlendCacheScene[] = [
  { name: 'alpha-blend-mode-test', lights: [SUN] },
];
