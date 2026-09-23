/**
 * Chalk: a layered cliff face and a sea stack. Chalk is laid down in beds, each a slab whose
 * edge the sea has cut back by its own amount, with a dark band of flint between two beds. A
 * face is `FACE.width` wide along X, faces +Z (the sea), stands `FACE.height` high and is
 * stretched vertically per instance to the cliff it dresses; its back sinks into the terrain.
 */
import type { MeshPart, PropMesh, Surface } from '../../../plan/contract.ts';
import {
  between,
  blob,
  extrude,
  flatShade,
  hash01,
  jitter,
  prop,
  transform,
  type Point2,
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

export const FACE = { width: 44, height: 50, depth: 12 } as const;

/** One bed: an outline raised by `thickness` at `y`, top capped, edges roughened. */
function bed(
  surface: Surface,
  outline: readonly Point2[],
  y: number,
  thickness: number,
  seed: number,
) {
  const slab = extrude(surface, outline, thickness, { caps: 'top' });
  return flatShade(transform(jitter(slab, [0.35, thickness * 0.2, 0.5], seed), { at: [0, y, 0] }));
}

/**
 * A stack of beds from y = 0 to `height`: `outlineAt(t, seed)` gives each bed's outline at
 * relative height t. A thin flint band lies under every other bed, set back a little.
 */
function strata(
  height: number,
  beds: number,
  outlineAt: (t: number, seed: number, setBack: number) => Point2[],
  seed: number,
): MeshPart[] {
  const parts: MeshPart[] = [];
  let y = 0;
  for (let i = 0; i < beds; i++) {
    const thickness = (height / beds) * between(seed, i, 0.75, 1.25),
      top = Math.min(height, y + thickness),
      t = y / height;
    const chalk = hash01(seed, i, 7) < 0.3 ? COAST.chalkShadow : COAST.chalk;
    parts.push(bed(chalk, outlineAt(t, seed + i * 31, 0), y, top - y, seed + i));
    if (i % 2 && top < height)
      parts.push(
        bed(COAST.flint, outlineAt(t, seed + i * 31, 0.8), top - 0.25, 0.5, seed + i + 500),
      );
    y = top;
    if (y >= height) break;
  }
  return parts;
}

/** A face's bed outline: a jagged front edge, straight back and sides. */
function faceOutline(t: number, seed: number, setBack: number): Point2[] {
  const steps = 200,
    half = FACE.width / 2,
    // Beds lean back as they climb, and each is cut back by its own amount.
    front = -t * 4 - between(seed, 1, 0, 2.5) - setBack;
  const edge = Array.from({ length: steps + 1 }, (_, i): Point2 => {
    const x = -half + (i / steps) * FACE.width,
      wave = 1.2 * Math.sin(x / 3.1 + seed) + 0.8 * Math.sin(x / 1.3 + seed * 3);
    return [x, front + wave * between(seed, i + 9, 0.4, 1)];
  });
  return [...edge, [half, -FACE.depth], [-half, -FACE.depth]];
}

/** A chalk face: beds, a turf cap overhanging the top, fallen blocks at the foot. */
export function cliffFace(id: string, seed: number): PropMesh {
  const beds = strata(FACE.height, 30, faceOutline, seed),
    turf = bed(COAST.grassCap, faceOutline(1, seed + 77, 0), FACE.height, 0.6, seed + 78),
    fallen = Array.from({ length: 9 }, (_, i) => {
      const size = between(seed, 200 + i, 1.2, 3.2);
      return transform(blob(COAST.chalk, [size, size * 0.7, size], seed + 300 + i, { detail: 3 }), {
        at: [-FACE.width / 2 + ((i + 0.5) / 9) * FACE.width, -0.2, between(seed, i, 0.5, 4)],
      });
    });
  return prop(id, [...beds, turf, ...fallen]);
}

/** A stack's bed outline: a rough ring narrowing toward the top. */
function stackOutline(t: number, seed: number, setBack: number): Point2[] {
  const steps = 96,
    radius = 9 * (1 - 0.35 * t) - setBack;
  return Array.from({ length: steps }, (_, i): Point2 => {
    const a = (i / steps) * Math.PI * 2,
      r = radius * between(seed, i, 0.8, 1.1) * (1 + 0.15 * Math.sin(a * 3 + seed));
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

/** A sea stack 34 m high standing in the surf off a chalk cliff, 18 m across at its foot. */
export const seaStack = (id: string, seed: number): PropMesh =>
  prop(id, [
    ...strata(34, 24, stackOutline, seed),
    transform(blob(COAST.grassCap, [6, 1.2, 6], seed + 9, { detail: 5 }), { at: [0, 33.6, 0] }),
  ]);
