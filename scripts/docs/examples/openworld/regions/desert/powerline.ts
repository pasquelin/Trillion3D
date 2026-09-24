/**
 * A high-voltage line on the kit's pylons: each span between two placed pylons is one prop of
 * six sagging conductors, hung from the insulators' tips. A span's shape depends on both
 * pylons' ground heights, so every span is its own mesh (a node's transform has no pitch).
 */
import type { Instance, PropMesh, Vec3 } from '../../plan/contract.ts';
import { applyPoint, prop, SURFACES, trsMatrix, tube } from '../../props/index.ts';

/**
 * Insulator tips in the kit pylon's frame (`props/industry.ts`): three strings hang 2.7 m under
 * each cross-arm, spread along X, so the conductors leave along Z.
 */
const TIPS: readonly Vec3[] = [30, 36].flatMap((y) => {
  const reach = y === 30 ? 8 : 6;
  return [-1, 0, 1].map((k): Vec3 => [k * (reach - 0.4) + (k ? 0 : 1.2), y - 2.7, 0]);
});

/** Mid-span sag over span length: 3 %, a common design value for steel-cored conductors. */
const SAG = 0.03;

/** The yaw that runs a pylon's line (its local Z) along the direction (dx, dz). */
export const lineYaw = (dx: number, dz: number) => Math.atan2(dx, dz);

/** The six conductors from pylon `a` to pylon `b`, as a prop placed at `a`'s position. */
export function cableSpan(id: string, a: Instance, b: Instance): PropMesh {
  const ma = trsMatrix({ at: a.position, yaw: a.yaw }),
    mb = trsMatrix({ at: b.position, yaw: b.yaw }),
    steps = 12;
  const cables = TIPS.map((tip) => {
    const p = applyPoint(ma, tip),
      q = applyPoint(mb, tip),
      length = Math.hypot(q[0] - p[0], q[2] - p[2]),
      points = Array.from({ length: steps + 1 }, (_, i): Vec3 => {
        const t = i / steps,
          sag = 4 * SAG * length * t * (1 - t);
        return [
          p[0] + (q[0] - p[0]) * t - a.position[0],
          p[1] + (q[1] - p[1]) * t - sag - a.position[1],
          p[2] + (q[2] - p[2]) * t - a.position[2],
        ];
      });
    return tube(SURFACES.darkMetal, points, 0.035, { segments: 3 });
  });
  return prop(id, cables);
}
