/**
 * Vehicle specs turned into meshes with the prop kit — the same parametric shapes the page
 * rebuilds with the engine's `geometry` family — and their bounds measured.
 */
import type { MeshPart, PropMesh, Surface } from '../plan/contract.ts';
import { partBounds } from './geometry.ts';
import { cone, cylinder, lathe, sphere, torus } from './round.ts';
import { box } from './shapes.ts';
import { bevelExtrude, roundedBox } from './smooth.ts';
import { multiply, prop, transform, trsMatrix, type Mat4 } from './transform.ts';
import type { PartRole, VehicleDraft, VehiclePart, VehicleSpec } from './vehicle-spec.ts';

/** The part's shape in its own frame, before rotation and position. */
function shapeOf(part: VehiclePart, surface: Surface): MeshPart {
  const [w, h, d] = part.size,
    segments = part.segments ?? 16,
    down = (mesh: MeshPart) => transform(mesh, { at: [0, -h / 2, 0] });
  switch (part.shape) {
    case 'box':
      return down(box(surface, part.size));
    case 'rounded-box':
      return down(roundedBox(surface, part.size, part.bevel ?? 0, segments));
    case 'cylinder':
      return down(
        transform(cylinder(surface, 0.5, 1, { segments, top: 0.5 * (part.taper ?? 1) }), {
          scale: part.size,
        }),
      );
    case 'cone':
      return down(transform(cone(surface, 0.5, 1, { segments }), { scale: part.size }));
    case 'sphere':
      return transform(sphere(surface, 0.5, { segments, rings: Math.max(4, segments >> 1) }), {
        scale: part.size,
      });
    case 'torus': {
      const tube = h / 2,
        ring = torus(surface, w / 2 - tube, tube, { segments, sides: Math.max(10, segments >> 2) });
      return transform(ring, { scale: [1, 1, d / w] });
    }
    case 'lathe':
      return transform(lathe(surface, part.profile ?? [], { segments }), { scale: part.size });
    case 'extrude': {
      const solid = bevelExtrude(surface, part.outline ?? [], part.depth ?? 1, {
        bevel: part.bevel ?? 0,
        segments: part.segments ?? 4,
        smooth: part.smooth ?? 0,
      });
      return transform(solid, { scale: part.size });
    }
  }
}

const AXES = { x: 'pitch', y: 'yaw', z: 'roll' } as const;

/** Every copy of one part in the vehicle frame. */
export function partMeshes(spec: VehicleDraft, part: VehiclePart): MeshPart[] {
  const surface = spec.surfaces[part.surface];
  if (!surface) throw new Error(`${spec.id}: unknown surface "${part.surface}"`);
  const [pitch, yaw, roll] = part.rotation ?? [0, 0, 0],
    own = trsMatrix({ at: part.position, pitch, yaw, roll }),
    shape = shapeOf(part, surface),
    { count = 1, step = [0, 0, 0], turn } = part.repeat ?? {};
  return Array.from({ length: count }, (_, i) => {
    let place: Mat4 = own;
    if (turn) {
      const [px, py, pz] = turn.pivot,
        spin = multiply(
          trsMatrix({ at: turn.pivot, [AXES[turn.axis]]: turn.angle * i }),
          trsMatrix({ at: [-px, -py, -pz] }),
        );
      place = multiply(spin, place);
    }
    place = multiply(trsMatrix({ at: [step[0] * i, step[1] * i, step[2] * i] }), place);
    return transform(shape, place);
  });
}

/**
 * The vehicle as one static prop (`vehicle-<id>`), every part included; `without` leaves out
 * the parts of those roles (a body whose wheels the page spins separately).
 */
export function vehicleProp(spec: VehicleDraft, without: readonly PartRole[] = []): PropMesh {
  const kept = spec.parts.filter((part) => !part.role || !without.includes(part.role));
  const suffix = without.length ? `-without-${[...without].sort().join('-')}` : '';
  return prop(
    `vehicle-${spec.id}${suffix}`,
    kept.flatMap((part) => partMeshes(spec, part)),
  );
}

/** The spec with its bounds measured from its parts, never typed by hand. */
export const withBounds = (draft: VehicleDraft): VehicleSpec => ({
  ...draft,
  bounds: partBounds(draft.parts.flatMap((part) => partMeshes(draft, part))),
});
