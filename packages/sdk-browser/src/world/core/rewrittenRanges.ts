import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';

/** Marks `ranges` of `geometry`'s lists written: a reader that uploads them sends those alone —
 *  the WebGL2 draw, which clears them; the WebGPU path is handed the ranges themselves. */
export function markRewritten(geometry: Geometry, ranges: readonly VertexRange[]) {
  for (const { name, from, count } of ranges) {
    const list = geometry.attributes[name] as BufferAttribute,
      start = from * list.itemSize,
      end = (from + count) * list.itemSize;
    // One range held, the union of those no reader took yet: a list nobody uploads never grows.
    const [held] = list.updateRanges;
    if (!held) list.addUpdateRange(start, end - start);
    else {
      const first = Math.min(held.start, start);
      held.count = Math.max(held.start + held.count, end) - first;
      held.start = first;
    }
    list.needsUpdate = true;
  }
}
