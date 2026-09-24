import type { HostAttributes } from '../../../host/resources.ts';
import { OPEN_CONE, triangleCone } from '../../../page/cone/cone.ts';
import { surfaceFrontOnly } from '../../../page/surface.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Every cluster carries its own cone; a double-sided or back-facing material keeps it open.
 *  Posting a cone is declaring it: the page's root raises its flag, or the cut would believe it has
 *  no cone and would no longer read `cone`. Pages are walked by root: the `allPages` catalogue is the
 *  concatenation of their pages, in the same order. */
export function prepareCones(rt: WebgpuPagesRuntime) {
  const xyzCache = new WeakMap<HostAttributes, Float32Array>();
  for (const root of rt.setup.roots)
    for (const rec of root.pages) {
      const array = rec.array,
        attr = rec.attributes.position;
      if (!array || !attr) continue;
      root.cones = true;
      let xyz = xyzCache.get(rec.attributes);
      if (!xyz) {
        xyz = new Float32Array(attr.count * 3);
        // A plain three-component attribute is already that array, copied as a block; any other —
        // interleaved, normalized, another stride — goes through the accessors that can read it.
        const flat = attr.array as ArrayLike<number> & {
          subarray?(begin: number, end: number): ArrayLike<number>;
        };
        if (
          attr.itemSize === 3 &&
          !attr.normalized &&
          attr.kind === 'attribute' &&
          flat.subarray &&
          flat.length >= attr.count * 3
        )
          xyz.set(flat.subarray(0, attr.count * 3));
        else
          for (let i = 0; i < attr.count; i++) {
            xyz[i * 3] = attr.getX(i);
            xyz[i * 3 + 1] = attr.getY(i);
            xyz[i * 3 + 2] = attr.getZ(i);
          }
        xyzCache.set(rec.attributes, xyz);
      }
      // Front-only alone gets a closed cone, and the side is read from the declaration at this
      // very moment: a surface the host later opens in place reopens its cone at the cut
      // (`../../../page/surface.ts`, `gpuSelection.leafCone`).
      rec.cone = surfaceFrontOnly(rec.material) ? triangleCone(xyz, array) : OPEN_CONE;
    }
}
