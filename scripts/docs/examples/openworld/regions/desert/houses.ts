/**
 * Mud-brick houses of the oasis, at real size, front door facing +Z. Thick plastered walls on a
 * plinth that reaches 1.5 m below the floor (the house sits level on uneven ground), flat roofs
 * behind a parapet, roof beams (vigas) jutting out under it, deep window reveals with timber
 * frames and shutters, rain spouts, and on the roof a stair hut, a water tank and a shade of
 * palm fronds. The courtyard house wraps four wings around an open yard behind an arched gate.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import {
  between,
  box,
  cylinder,
  prop,
  quads,
  roundedBox,
  SURFACES,
  transform,
  tube,
} from '../../props/index.ts';
import { DESERT } from './palette.ts';
import { archedGate, facade, jar, parapet } from './walls.ts';

/** How far every building's plinth reaches under its floor, metres. */
export const PLINTH = 1.5;

/** Everything that stands on the roof at height `h` of a `w × d` house. */
function roofTop(w: number, d: number, h: number, seed: number): MeshPart[] {
  const parts: MeshPart[] = parapet(w, d, h);
  const beams = Math.floor(w / 0.9);
  for (let i = 0; i < beams; i++)
    for (const side of [-1, 1])
      parts.push(
        transform(cylinder(DESERT.palmWood, 0.1, 0.7, { segments: 6 }), {
          at: [-w / 2 + 0.45 + i * 0.9, h - 0.35, side * (d / 2 - 0.1)],
          pitch: (side * Math.PI) / 2,
        }),
      );
  for (const x of [-w / 2 + 0.6, w / 2 - 0.6])
    parts.push(
      transform(box(DESERT.palmWood, [0.16, 0.14, 0.9]), { at: [x, h + 0.1, d / 2 + 0.3] }),
    );
  // Stair hut, water tank, frond shade.
  const hx = between(seed, 1, -w / 4, w / 4),
    tx = hx > 0 ? hx - 1.9 : hx + 1.9,
    [z0, z1] = [d * 0.05, d * 0.4];
  parts.push(transform(box(DESERT.mudPlaster, [2.2, 2.3, 2.2]), { at: [hx, h, -d / 4] }));
  parts.push(transform(box(DESERT.palmWood, [0.9, 1.9, 0.06]), { at: [hx, h, -d / 4 + 1.12] }));
  parts.push(
    transform(cylinder(SURFACES.whitePaint, 0.6, 1.3, { segments: 16 }), {
      at: [tx, h + 0.4, -d / 4],
    }),
  );
  parts.push(
    tube(
      SURFACES.steel,
      [
        [tx, h + 1.7, -d / 4],
        [tx, h + 1.9, -d / 4 + 0.8],
      ],
      0.03,
      { segments: 5 },
    ),
  );
  for (const [x, z] of [
    [-1.2, z0],
    [1.2, z0],
    [-1.2, z1],
    [1.2, z1],
  ])
    parts.push(
      transform(cylinder(DESERT.palmWood, 0.05, 2.2, { segments: 5 }), { at: [x + hx, h, z] }),
    );
  for (let j = 0; j < 3; j++)
    parts.push(transform(jar(), { at: [hx + 0.8 * (j - 1), h, -d / 4 - 1.6] }));
  parts.push(
    quads(DESERT.frondShade, [
      [
        [hx - 1.5, h + 2.2, z0 - 0.2],
        [hx - 1.5, h + 2.2, z1 + 0.2],
        [hx + 1.5, h + 2.2, z1 + 0.2],
        [hx + 1.5, h + 2.2, z0 - 0.2],
      ],
    ]),
  );
  return parts;
}

/** A house `w × d`, `floors` storeys of 3.2 m, walls of `wall` over a plinth `PLINTH` deep. */
function mudHouse(
  id: string,
  w: number,
  d: number,
  floors: number,
  wall: Surface,
  seed: number,
): PropMesh {
  const h = floors * 3.2,
    parts: MeshPart[] = [
      transform(roundedBox(wall, [w, h + PLINTH, d], 0.3, 4), { at: [0, -PLINTH, 0] }),
      transform(roundedBox(DESERT.mudBrick, [w + 0.3, 0.5 + PLINTH, d + 0.3], 0.15, 2), {
        at: [0, -PLINTH, 0],
      }),
      ...facade(w, floors, d / 2, true, seed),
      ...facade(w, floors, d / 2, false, seed + 1).map((p) => transform(p, { yaw: Math.PI })),
      ...facade(d, floors, w / 2, false, seed + 2).map((p) => transform(p, { yaw: Math.PI / 2 })),
      ...facade(d, floors, w / 2, false, seed + 3).map((p) => transform(p, { yaw: -Math.PI / 2 })),
      ...roofTop(w, d, h, seed),
    ];
  return prop(id, parts);
}

/** A courtyard house: four wings `wing` deep around a yard, the gate in the front wing. */
function courtyardHouse(id: string, size: number, wing: number, seed: number): PropMesh {
  const h = 3.4,
    yard = size - 2 * wing,
    parts: MeshPart[] = [];
  const wingAt = (len: number, dx: number, dz: number, yaw: number, s: number, gate: boolean) => {
    const block = [
      transform(roundedBox(DESERT.mudPlaster, [len, h + PLINTH, wing], 0.3, 4), {
        at: [0, -PLINTH, 0],
      }),
      ...facade(len, 1, wing / 2, false, s),
      ...roofTop(len, wing, h, s),
      ...(gate ? archedGate(2.6, 3.2, wing / 2 + 0.1) : []),
    ];
    for (const part of block) parts.push(transform(part, { at: [dx, 0, dz], yaw }));
  };
  wingAt(size, 0, yard / 2 + wing / 2, 0, seed, true);
  wingAt(size, 0, -(yard / 2 + wing / 2), Math.PI, seed + 1, false);
  wingAt(yard, yard / 2 + wing / 2, 0, Math.PI / 2, seed + 2, false);
  wingAt(yard, -(yard / 2 + wing / 2), 0, -Math.PI / 2, seed + 3, false);
  parts.push(transform(cylinder(DESERT.mudBrick, 0.9, 0.8, { segments: 20 }), { at: [0, 0, 0] }));
  return prop(id, parts);
}

/** The oasis houses: plain, two-storey, and courtyard, in two wall finishes. */
export const houseProps = (seed: number): PropMesh[] => [
  mudHouse('desert/house-small', 6, 5, 1, DESERT.mudPlaster, seed),
  mudHouse('desert/house-long', 11, 6, 1, DESERT.mudBrick, seed + 1),
  mudHouse('desert/house-tall', 8, 7, 2, DESERT.mudPlaster, seed + 2),
  mudHouse('desert/house-tower', 6, 6, 3, DESERT.mudBrick, seed + 3),
  mudHouse('desert/house-white', 9, 8, 2, DESERT.limewash, seed + 4),
  mudHouse('desert/house-wide', 14, 9, 1, DESERT.limewash, seed + 5),
  courtyardHouse('desert/courtyard-house', 18, 5, seed + 6),
  courtyardHouse('desert/courtyard-manor', 26, 6, seed + 7),
];
