/**
 * Maintenance hangars: a barrel roof on lattice arches (top and bottom chords, a zigzag web)
 * tied by purlins, clad sides and back, and the door wall on +Z with its leaves slid open to
 * both sides, so the lit work floor, its docking platforms and stairs show through. Two sizes:
 * a 70 m narrow-body hangar and a 96 m wide-body one.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import type { Footprint } from './placer.ts';
import { arcPoints, gable, latticeArch, member, repeat, vault } from './parts.ts';

export type HangarSize = {
  span: number;
  depth: number;
  wall: number;
  rise: number;
  arches: number;
};
export const HANGARS = {
  standard: { span: 70, depth: 60, wall: 14, rise: 12, arches: 15 },
  wide: { span: 96, depth: 80, wall: 22, rise: 14, arches: 17 },
} as const satisfies Record<string, HangarSize>;
export const HANGAR_PLINTH = 2;
const SEGMENTS = 32;

/** Door leaves stack this far in front of the door wall. */
const LEAF_STACK = 0.4 + 5 * 0.45 + 0.2;

/** The hangar and its stacked door leaves, in the prop's frame. */
export const hangarFootprint = (size: HangarSize): Footprint => {
  const back = -size.depth / 2 - 0.5,
    front = size.depth / 2 + LEAF_STACK;
  return [[0, (back + front) / 2, size.span / 2 + 0.5, (front - back) / 2]];
};

/** One lattice arch at z on its two columns; purlins tie it to the next one along +Z. */
function bay(size: HangarSize, z: number, spacing: number): MeshPart[] {
  const { steel } = SURFACES,
    half = size.span / 2,
    outer = arcPoints(half, size.rise, SEGMENTS),
    purlin = (x: number, y: number) =>
      member(
        steel,
        [x, size.wall + y - 0.45, z],
        [x, size.wall + y - 0.45, z + spacing],
        [0.12, 0.2],
      );
  return [
    ...latticeArch(steel, {
      half,
      rise: size.rise,
      y: size.wall - 0.3,
      z,
      chord: 1.6,
      segments: SEGMENTS,
    }),
    ...[-1, 1].map((side) =>
      member(steel, [side * (half - 0.6), 0, z], [side * (half - 0.6), size.wall, z], [0.8, 0.5]),
    ),
    ...(spacing > 0 ? outer.map(([x, y]) => purlin(x, y)) : []),
  ];
}

function shell(size: HangarSize): MeshPart[] {
  const { hangarSkin } = AIRPORT,
    { span, depth, wall, rise } = size,
    [half, z] = [span / 2, depth / 2];
  return [
    transform(box(SURFACES.concrete, [span + 1, HANGAR_PLINTH + 0.2, depth + 1]), {
      at: [0, -HANGAR_PLINTH, 0],
    }),
    ...vault(hangarSkin, [half, rise, depth, wall], SEGMENTS, AIRPORT.cladding),
    ...[-1, 1].map((side) =>
      transform(box(hangarSkin, [0.3, wall, depth]), { at: [side * half, 0, 0] }),
    ),
    transform(box(hangarSkin, [span, wall, 0.3]), { at: [0, 0, -z] }),
    gable(hangarSkin, [half, rise, -z, wall], SEGMENTS),
    // Rooflights along the crown, and the door wall's header over the opening.
    ...repeat(
      box(AIRPORT.curtain, [6, 0.3, 4]),
      5,
      [0, wall + rise - 0.1, -z + 10],
      [0, 0, (depth - 20) / 4],
    ),
    gable(hangarSkin, [half, rise, z, wall], SEGMENTS),
    transform(box(hangarSkin, [span, 3, 1.2]), { at: [0, wall - 3, z - 0.6] }),
  ];
}

/** Door leaves: six per side, stacked open behind the jambs, on a rail. */
function doors(size: HangarSize): MeshPart[] {
  const width = size.span / 12,
    leaf = box(AIRPORT.hangarSkin, [width - 0.2, size.wall - 3.2, 0.35]),
    half = size.span / 2;
  return [-1, 1].flatMap((side) =>
    Array.from({ length: 6 }, (_, i) =>
      transform(leaf, {
        at: [side * (half - width / 2 - 0.3 - (i % 2) * 0.4), 0, size.depth / 2 + 0.4 + i * 0.45],
      }),
    ),
  );
}

/** Work floor: epoxy, two docking platforms with stairs and rails, ceiling floodlights. */
function workFloor(size: HangarSize): MeshPart[] {
  const { steel, craneYellow } = SURFACES,
    reach = size.span / 5;
  const platform = (x: number) => [
    transform(box(AIRPORT.safetyOrange, [4, 0.3, 14]), { at: [x, 4.5, 0] }),
    ...[-1.8, 1.8].flatMap((dx) =>
      repeat(cylinder(steel, 0.12, 4.5, { segments: 8 }), 3, [x + dx, 0, -6], [0, 0, 6]),
    ),
    ...[-2, 2].map((dx) =>
      tube(
        craneYellow,
        [
          [x + dx, 5.6, -7],
          [x + dx, 5.6, 7],
        ],
        0.04,
      ),
    ),
    ...Array.from({ length: 15 }, (_, i) =>
      transform(box(steel, [1.2, 0.08, 0.3]), { at: [x, i * 0.3, -7.2 - i * 0.25] }),
    ),
    ...[-0.65, 0.65].map((dx) =>
      member(steel, [x + dx, 0, -10.9], [x + dx, 4.5, -7.2], [0.08, 0.3]),
    ),
  ];
  return [
    transform(box(AIRPORT.floor, [size.span - 1, 0.1, size.depth - 1]), { at: [0, 0, 0] }),
    ...platform(-reach),
    ...platform(reach),
    ...[-1, 0, 1].flatMap((i) =>
      [-1, 0, 1].map((k) =>
        transform(box(LIGHTS.ceiling, [2.4, 0.1, 1.2]), {
          at: [i * reach, size.wall + 2, (k * size.depth) / 4],
        }),
      ),
    ),
  ];
}

export function hangar(id: string, size: HangarSize): PropMesh {
  const spacing = (size.depth - 4) / (size.arches - 1);
  return prop(id, [
    ...shell(size),
    ...doors(size),
    ...workFloor(size),
    ...Array.from({ length: size.arches }, (_, i) =>
      bay(size, -size.depth / 2 + 2 + i * spacing, i === size.arches - 1 ? 0 : spacing),
    ).flat(),
  ]);
}
