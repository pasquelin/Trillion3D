import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../sdk-core/src/index.ts';
import { MOVE_PROMOTED } from '../../placement/update.ts';
import type { HostAttributes } from '../../host/resources.ts';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { WebgpuPagesRuntime } from './runtime.ts';

/** The world box of one root and the union of them, allocated once: a frame allocates nothing. */
const moved = new Float64Array(BOX_VALUES),
  union = new Float64Array(BOX_VALUES);

/**
 * The shadow pages a dynamic geometry's rewrite touches, and none other (#489): each root that
 * draws `attributes` is a moving caster from its first rewrite on — the static layer leaves it
 * out, as it does a node that moves (`../shadow/mobility.ts`) —, and the world box of `box`, its
 * moved vertices where they were and where they go, stales the pages it covers
 * (`light-shadow/invalidate.ts`), whole on that first rewrite, its moving casters alone after.
 */
function staleShadows(rt: WebgpuPagesRuntime, attributes: HostAttributes, box: Float64Array) {
  const { layout, lights } = rt;
  const roots = layout.selectionRoots;
  let promoted = false;
  boxEmpty(union, 0);
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank];
    if (root.pages[0]?.attributes !== attributes) continue;
    promoted = lights.mobility.move(rank, root.world.elements, true) === MOVE_PROMOTED || promoted;
    boxTransform(moved, 0, box, 0, root.world.elements);
    boxUnionBatch(union, moved, 1);
  }
  if (!boxIsEmpty(union, 0))
    lights.plan.worldChanged(union.subarray(0, 3), union.subarray(3, 6), !promoted);
}

/**
 * A dynamic geometry's rewritten lists, written in place (#573): its block of the float vertex
 * pool (`../core/geometryPrepare.ts`) — placed in the pool's room when a record took it since
 * the open —, the fallback draw's positions, then its shadow pages, and the next frame is drawn:
 * no buffer allocated, no table rebuilt. False when the pool has no room left for it: the owner
 * opens the session again.
 */
export function updateWebgpuVertices(
  rt: WebgpuPagesRuntime,
  attributes: HostAttributes,
  ranges: readonly VertexRange[],
  box: Float64Array,
) {
  const { vis, gpu, run } = rt;
  if (!gpu.device || run.lost) return false;
  const pool = vis.vertexPool;
  if (pool && !pool.place(attributes, true)) return false;
  const positions = gpu.positionBuffers.get(attributes),
    xyz = attributes.position?.array;
  for (const { name, from, count } of ranges) {
    pool?.write(attributes, name, from, count);
    if (name === 'position' && positions && xyz instanceof Float32Array)
      gpu.device.queue.writeBuffer(
        positions,
        from * 12,
        xyz as Float32Array<ArrayBuffer>,
        from * 3,
        count * 3,
      );
  }
  staleShadows(rt, attributes, box);
  run.gate.sceneMoved();
  return true;
}
