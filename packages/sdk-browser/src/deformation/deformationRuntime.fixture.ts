import { createDeformationFrame } from './frame.ts';
import { createWebgpuLightState } from '../webgpu/pages/state/lights.ts';
import type { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

/**
 * The pages runtime `updateWebgpuDeformation` reads, around one deformation `frame`: placements
 * `selectionRoots` and their `rows`, no pixel error, and a light state that records every world box
 * it is told changed (`changed`, min then max).
 */
export function deformationRuntime(
  world: Matrix4,
  frame: ReturnType<typeof createDeformationFrame>,
  selectionRoots: object[],
  rows: object,
) {
  const lights = createWebgpuLightState();
  lights.mobility.ensure(1, 2, () => world.elements);
  const changed: number[][] = [];
  Object.assign(lights.changes, {
    worldChanged: (min: ArrayLike<number>, max: ArrayLike<number>) => {
      changed.push([...Array.from(min), ...Array.from(max)]);
    },
  });
  const rt = {
    // A zero pixel error skips no placement (`screen.ts`).
    vis: {
      deformation: { any: true, frame, base: 0, update: () => frame.update(() => false) },
      concatPos: {},
    },
    gpu: { device: { queue: { writeBuffer() {} } } },
    lights,
    layout: { selectionRoots, rows },
    run: { gate: { pixelError: 0 }, temporalHizState: {} },
    setup: {},
    blendState: { blendGpu: [] },
  } as unknown as WebgpuPagesRuntime;
  return { rt, changed };
}
