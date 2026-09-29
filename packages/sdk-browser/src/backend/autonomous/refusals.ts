import type { BackendDiagnostic } from '../types.ts';
import { takeOutOfMemory } from '../../webgl/core/allocation.ts';
import { outOfMemoryContext } from '../../residency/outOfMemory.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';

/** The pools a refusal shrinks nothing of: sized or sent again at their next use. */
const UNSHRUNK = ['target', 'texture'] as const;

/**
 * The autonomous WebGL2 frame's answer to the allocations its context refused since the last one
 * (`../../webgl/core/allocation.ts`), run before the frame enters its gate (`render.ts`). A refused
 * geometry allocation draws this frame a level coarser (`pool.ts`, `outOfMemory`). A frame target
 * is sized again at its next draw and a map sent again at its next bind — no coarser picture to
 * show instead —: nothing to shrink, the refusal is published as `gpu-out-of-memory`. Whatever was
 * refused, the images drawn since drew without it: `redraw` draws this one again.
 */
export function createRefusalAnswer(options: {
  gl: () => WebGL2RenderingContext | null | undefined;
  pool: { outOfMemory(): boolean };
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  redraw: () => void;
}) {
  const { pool, onDiagnostic, redraw } = options;
  return () => {
    const gl = options.gl();
    const geometry = takeOutOfMemory(gl, 'geometry');
    if (geometry) pool.outOfMemory();
    let refused = geometry;
    for (const pool of UNSHRUNK)
      if (takeOutOfMemory(gl, pool)) {
        refused = true;
        sendEngineDiagnostic(
          onDiagnostic,
          'gpu-out-of-memory',
          `WebGL2 refused a ${pool === 'target' ? 'frame target' : 'map'}`,
          outOfMemoryContext(pool, null),
        );
      }
    if (refused) redraw();
  };
}
