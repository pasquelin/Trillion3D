// The receivers the screen-reflection tests share: physical surfaces in a view's rows, and the
// shipped display resolve run over a stubbed trace.
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { SCREEN_REFLECTION_WGSL } from './screenWgsl.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { createWebgpuRowState } from '../webgpu/row/state.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { PageSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

export const physical = (roughness: number) => ({ lit: true, model: 0, roughness }) as PageSurface;

/** A beauty view whose rows hold `recs` and whose forward pass draws `forward`. */
export function rowsRuntime(recs: PageRec[], forward: PageSurface[] = []) {
  const rows = createWebgpuRowState([], recs.length);
  rows.packedCount = recs.length;
  rows.packedRecs.splice(0, recs.length, ...recs);
  const rt = {
    run: { diagnostic: 'beauty' },
    layout: { rows },
    blendState: { blendGpu: forward.map((surface) => ({ surface })) },
  } as unknown as WebgpuPagesRuntime;
  return { rows, rt };
}

/** A view whose rows wear the `opaque` surfaces, one row each. */
export const sceneOf = (opaque: PageSurface[], forward: PageSurface[] = []) =>
  rowsRuntime(
    opaque.map((material) => ({ material }) as PageRec),
    forward,
  ).rt;

export const ENVIRONMENT = [3, 3, 3],
  RAY = [7, 7, 7],
  FILTERED = [5, 5, 5];

/** A shipped screen resolve (by default WebGPU's `resolvedRadiance`), its trace answering `RAY` for
 *  the mirror ray and `FILTERED` for the cone on a hit and nothing on a miss, its `fallback`
 *  `ENVIRONMENT`; each call counted. `shader`, `entry`, `fallback` and `globals` give another
 *  program's spelling (the WebGL2 one, `screenGlsl.test.ts`). */
export function resolvedDisplay({
  enabled = 1,
  hit = true,
  weight = (rough: number) => +(rough <= Number(ROUGHNESS_FLOOR)),
  shader = SCREEN_REFLECTION_WGSL,
  entry = 'resolvedRadiance',
  fallback = 'reflectedRadiance',
  globals = {} as Record<string, unknown>,
  functions = [] as string[],
} = {}) {
  const calls = { traced: 0, fallback: 0 };
  const program = shaderRun<
    Record<string, (P: number[], N: number[], R: number[], rough: number) => number[]>
  >(
    shader,
    [
      'resolvedReflectionRay',
      'filteredResolvedReflection',
      'screenReflectionFade',
      entry,
      ...functions,
    ],
    {
      reflectionView: { enabled: [enabled, 0, 0, 0] },
      mirrorWeight: weight,
      screenReflection: () => (calls.traced++, hit ? [...RAY, 1] : [0, 0, 0, 0]),
      screenReflectionCone: () => (calls.traced++, hit ? [...FILTERED, 1] : [0, 0, 0, 0]),
      [fallback]: () => (calls.fallback++, ENVIRONMENT),
      ...globals,
    },
  );
  return { calls, at: (rough: number) => program[entry]!([0, 0, 0], [0, 1, 0], [0, 1, 0], rough) };
}
