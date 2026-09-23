/**
 * Dune and roadside pieces: tufts of marram grass (blades that lean and curl out from a clump,
 * each a tapered strip of three segments) and a steel W-beam guardrail bay of 4 m along X on
 * two posts, its face toward +Z (the road).
 */
import type { MeshPart, PropMesh, Vec3 } from '../../../plan/contract.ts';
import { between, box, prop, quads, SURFACES, transform } from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

/** One blade from the clump: `height` tall, leaning out at `angle`, curling as it rises. */
function blade(angle: number, height: number, lean: number, width: number): MeshPart {
  const [dx, dz] = [Math.cos(angle), Math.sin(angle)],
    // The blade's width lies across its lean.
    [wx, wz] = [-dz * width, dx * width],
    at = (t: number, side: number): Vec3 => {
      const out = lean * height * t * t,
        w = (1 - 0.85 * t) * side * 0.5;
      return [dx * out + wx * w, height * t * (1 - 0.15 * t), dz * out + wz * w];
    };
  const faces: Vec3[][] = [];
  const steps = 3;
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps,
      t1 = (s + 1) / steps;
    faces.push([at(t0, -1), at(t0, 1), at(t1, 1), at(t1, -1)]);
  }
  return quads(COAST.marramGrass, faces);
}

/** A tuft of `blades` blades about `height` high. */
function grassTuft(id: string, blades: number, height: number, seed: number): PropMesh {
  return prop(
    id,
    Array.from({ length: blades }, (_, i) =>
      blade(
        (i / blades) * Math.PI * 2 + between(seed, i, -0.3, 0.3),
        height * between(seed, i + 100, 0.6, 1.1),
        between(seed, i + 200, 0.2, 0.7),
        between(seed, i + 300, 0.02, 0.04),
      ),
    ),
  );
}

/** A 4 m guardrail bay: two posts, a W-shaped beam in three folds, a reflector on each post. */
function guardrail(): PropMesh {
  const profile: [number, number][] = [
    [0.45, 0],
    [0.52, 0.07],
    [0.6, 0.02],
    [0.68, 0.07],
    [0.75, 0],
  ];
  const beam: Vec3[][] = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [y0, z0] = profile[i],
      [y1, z1] = profile[i + 1];
    beam.push([
      [-2, y0, 0.12 + z0],
      [2, y0, 0.12 + z0],
      [2, y1, 0.12 + z1],
      [-2, y1, 0.12 + z1],
    ]);
  }
  const parts: MeshPart[] = [quads(COAST.galvanised, beam)];
  for (const x of [-1.9, 0.1]) {
    parts.push(transform(box(COAST.galvanised, [0.12, 0.8, 0.1]), { at: [x, 0, 0] }));
    parts.push(transform(box(SURFACES.signalAmber, [0.05, 0.08, 0.02]), { at: [x, 0.85, 0.06] }));
  }
  return prop('coast-guardrail', parts);
}

export const duneProps = (seed: number): PropMesh[] => [
  grassTuft('coast-marram-small', 24, 0.6, seed),
  grassTuft('coast-marram-large', 40, 1.0, seed + 1),
  grassTuft('coast-marram-sparse', 14, 0.8, seed + 2),
  guardrail(),
];
