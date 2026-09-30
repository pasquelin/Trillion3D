import { box } from '../world/geometry/basic.ts';
import { Mesh } from '../world/object/mesh.ts';

/** An axis-aligned solid between two world-space corners. */
export function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const mesh = new Mesh(box(x1 - x0, y1 - y0, z1 - z0));
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}

/** Exposes local geometry at a translated world origin, preserving live contact pushes. */
export function rebase(
  world: import('./characterCollision.ts').CharacterCollision,
  y: number,
): import('./characterCollision.ts').CharacterCollision {
  const local = (capsule: import('./capsule.ts').Capsule) => ({
    ...capsule,
    feet: new Float64Array([capsule.feet[0], capsule.feet[1] - y, capsule.feet[2]]),
  });
  const raised = (touch: import('./capsule.ts').CapsuleContact) => ({
    ...touch,
    point: new Float64Array([touch.point[0], touch.point[1] + y, touch.point[2]]),
  });
  return {
    resolveCapsule(capsule, push) {
      const shifted = local(capsule);
      return world.resolveCapsule(shifted, (touch) => {
        push(raised(touch));
        shifted.feet.set(local(capsule).feet);
      });
    },
    groundBelow: (capsule, depth, accepts) =>
      world.groundBelow(local(capsule), depth, (touch) => accepts(raised(touch))),
  };
}
