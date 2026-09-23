/**
 * Facade pieces for the coast's buildings: a framed window with sill and shutters, a door with
 * its frame and step, a tiled pitched roof laid in courses. Every piece is built facing +Z at the
 * origin and turned onto its wall by the caller.
 */
import type { MeshPart, Surface } from '../../../plan/contract.ts';
import { box, roofPrism, roundedBox, SURFACES, transform, tube } from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

/** A window `w` × `h` whose sill is at y = 0: frame, mullion, pane, sill, open shutters. */
export function framedWindow(w: number, h: number, pane: Surface, shutter?: Surface): MeshPart[] {
  const frame = COAST.whitewash,
    bar = 0.08;
  const parts = [
    transform(box(pane, [w, h, 0.04]), { at: [0, 0, -0.06] }),
    transform(roundedBox(frame, [w + bar * 2, bar, 0.12], 0.02, 1), { at: [0, h, 0] }),
    transform(roundedBox(frame, [w + bar * 2, bar, 0.12], 0.02, 1), { at: [0, -bar, 0] }),
    transform(roundedBox(frame, [bar, h, 0.12], 0.02, 1), { at: [-w / 2 - bar / 2, 0, 0] }),
    transform(roundedBox(frame, [bar, h, 0.12], 0.02, 1), { at: [w / 2 + bar / 2, 0, 0] }),
    transform(box(frame, [0.05, h, 0.08]), { at: [0, 0, -0.02] }),
    transform(box(frame, [w, 0.05, 0.08]), { at: [0, h * 0.62, -0.02] }),
    transform(box(COAST.quayStone, [w + 0.3, 0.08, 0.28]), { at: [0, -0.16, 0.08] }),
  ];
  if (shutter)
    for (const side of [-1, 1]) {
      const x = side * (w / 2 + bar + w / 4 + 0.02);
      parts.push(transform(box(shutter, [w / 2, h, 0.05]), { at: [x, 0, 0.06] }));
      for (const y of [0.2, 0.5, 0.8])
        parts.push(transform(box(shutter, [w / 2 - 0.06, 0.05, 0.03]), { at: [x, h * y, 0.1] }));
    }
  return parts;
}

/** A door `w` × `h` on the ground: leaf, frame, lintel, a stone step. */
export function framedDoor(w: number, h: number, leaf: Surface): MeshPart[] {
  const frame = COAST.whitewash;
  return [
    transform(box(leaf, [w, h, 0.06]), { at: [0, 0, -0.04] }),
    transform(box(frame, [0.12, h, 0.14]), { at: [-w / 2 - 0.06, 0, 0] }),
    transform(box(frame, [0.12, h, 0.14]), { at: [w / 2 + 0.06, 0, 0] }),
    transform(box(COAST.quayStone, [w + 0.5, 0.22, 0.2]), { at: [0, h, 0.02] }),
    transform(box(COAST.quayStone, [w + 0.4, 0.18, 0.5]), { at: [0, -0.18, 0.25] }),
    transform(box(SURFACES.darkMetal, [0.05, 0.05, 0.1]), { at: [w * 0.35, h * 0.48, 0.02] }),
  ];
}

/**
 * A pitched roof over `width` × `depth`, ridge along X, laid in tile courses: each course a
 * strip standing proud of the one above, so the slope reads in raking light. Gutters on eaves.
 */
export function tiledRoof(
  surface: Surface,
  width: number,
  depth: number,
  rise: number,
  overhang = 0.4,
): MeshPart[] {
  const run = depth / 2 + overhang,
    slope = Math.atan2(rise, run),
    length = Math.hypot(run, rise),
    courses = Math.max(4, Math.round(length / 0.33)),
    parts = [
      roofPrism(surface, width, depth, rise, { overhang }),
      transform(box(surface, [width + overhang * 2 + 0.1, 0.18, 0.3]), { at: [0, rise - 0.04, 0] }),
    ];
  for (const side of [-1, 1]) {
    for (let c = 0; c < courses; c++) {
      const along = ((c + 0.5) / courses) * length,
        z = side * along * Math.cos(slope),
        y = rise - along * Math.sin(slope);
      parts.push(
        transform(box(surface, [width + overhang * 2, 0.05, length / courses]), {
          at: [0, y + 0.03, z],
          pitch: side * slope,
        }),
      );
    }
    parts.push(
      tube(
        SURFACES.darkMetal,
        [
          [-width / 2 - overhang, -0.08, side * run],
          [width / 2 + overhang, -0.08, side * run],
        ],
        0.07,
        { segments: 6 },
      ),
    );
  }
  return parts;
}
