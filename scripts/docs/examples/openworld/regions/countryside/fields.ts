/**
 * The patchwork: each field is a thin mesh draped over the plan's ground, its crop standing at its
 * own height (wheat, rapeseed and lavender as a block of crop with a skirt round its edge, pasture
 * and ploughed earth just above the soil). Hedgerows and dry-stone walls run along field edges,
 * with an oak left standing in the hedge here and there.
 */
import type { Instance, MeshPart, PropMesh, Surface, WorldPlan } from '../../plan/contract.ts';
import { hash01, meshPart, prop } from '../../props/index.ts';
import { GROUND_COVER, type Rect } from './footprint.ts';
import { LAND } from './ground.ts';
import { frame } from './land.ts';
import { BAY } from './nature.ts';
import type { Site } from './site.ts';

// Waiting on the engine: terrain decals or a splat map, so fields are painted into the ground
// rather than draped over it as their own meshes.

/** A crop: its surface and how high it stands above the soil, metres. */
export const CROPS: readonly { surface: Surface; lift: number }[] = [
  { surface: LAND.wheat, lift: 0.9 },
  { surface: LAND.rapeseed, lift: 1.2 },
  { surface: LAND.lavender, lift: 0.6 },
  { surface: LAND.pasture, lift: 0.25 },
  { surface: LAND.ploughed, lift: 0.2 },
];
/** Depth the skirt reaches below the soil, so no gap shows at a field's edge. */
const SKIRT = 0.4;

export type Field = { id: string; rect: Rect; crop: number };

/** Cells of a field's grid along its two sides, for a grid step of about `step` metres. */
const cells = ({ rect }: Field, step: number) =>
  [
    Math.max(1, Math.round((2 * rect.hx) / step)),
    Math.max(1, Math.round((2 * rect.hz) / step)),
  ] as const;

/** Triangles `fieldMesh` makes for a field: two per cell on top, two per border step. */
export function fieldTriangles(field: Field, step: number): number {
  const [nx, nz] = cells(field, step);
  return 2 * nx * nz + 4 * (nx + nz);
}

/** A field's mesh on a grid of about `step` metres, in the field's own frame at its centre. */
export function fieldMesh(plan: WorldPlan, field: Field, step: number): [PropMesh, Instance] {
  const { rect } = field,
    { surface, lift } = CROPS[field.crop],
    place = frame(rect.x, rect.z, rect.yaw),
    base = plan.height(rect.x, rect.z),
    [nx, nz] = cells(field, step),
    positions: number[] = [],
    indices: number[] = [],
    ground = (a: number, b: number) => plan.height(...place.at(a, b)) - base;
  const local = (i: number, j: number) => [
    -rect.hx + (2 * rect.hx * i) / nx,
    -rect.hz + (2 * rect.hz * j) / nz,
  ];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const [a, b] = local(i, j);
      positions.push(a, ground(a, b) + lift, b);
    }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const v = i * (nz + 1) + j;
      indices.push(v, v + 1, v + nz + 2, v, v + nz + 2, v + nz + 1);
    }
  // The skirt: the border walked counter-clockwise from above, each step a quad facing out.
  const border: [number, number][] = [
    ...Array.from({ length: nx }, (_, i): [number, number] => [i, nz]),
    ...Array.from({ length: nz }, (_, j): [number, number] => [nx, nz - j]),
    ...Array.from({ length: nx }, (_, i): [number, number] => [nx - i, 0]),
    ...Array.from({ length: nz }, (_, j): [number, number] => [0, j]),
  ];
  const skirt: number[] = [],
    skirtIndices: number[] = [];
  border.forEach(([i, j], k) => {
    const [ni, nj] = border[(k + 1) % border.length],
      [a0, b0] = local(i, j),
      [a1, b1] = local(ni, nj),
      g0 = ground(a0, b0),
      g1 = ground(a1, b1),
      first = skirt.length / 3;
    skirt.push(a0, g0 - SKIRT, b0, a1, g1 - SKIRT, b1, a1, g1 + lift, b1, a0, g0 + lift, b0);
    skirtIndices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  const parts: MeshPart[] = [
    meshPart(surface, positions, indices),
    meshPart(surface, skirt, skirtIndices, 'flat'),
  ];
  return [
    prop(`countryside${GROUND_COVER}${field.id}`, parts),
    {
      prop: `countryside${GROUND_COVER}${field.id}`,
      position: [rect.x, base, rect.z],
      yaw: rect.yaw,
      name: `countryside/field-${field.id}`,
    },
  ];
}

/**
 * Hedges or walls along a field's north (-Z) and east (+X) edges, just outside it: a bay every
 * `BAY` metres stretched to fit, now and then an oak standing in the hedgerow.
 */
export function fieldEdges(site: Site, rect: Rect, seed: number) {
  const place = frame(rect.x, rect.z, rect.yaw),
    sides = [
      { along: rect.hx, at: (t: number) => place.at(t, -rect.hz - 1.4), yaw: 0 },
      { along: rect.hz, at: (t: number) => place.at(rect.hx + 1.4, t), yaw: Math.PI / 2 },
    ];
  sides.forEach(({ along, at, yaw }, side) => {
    const kind = hash01(seed, side);
    if (kind > 0.8) return;
    const bay = kind < 0.55 ? 'countryside/hedge' : 'countryside/stone-wall',
      count = Math.floor((2 * along) / BAY),
      stretch = (2 * along) / (count * BAY);
    for (let n = 0; n < count; n++) {
      const [x, z] = at(-along + (n + 0.5) * BAY * stretch),
        oak = bay === 'countryside/hedge' && hash01(seed + 3, side, n) < 0.12;
      if (oak) site.place('tree-oak-large', x, z, hash01(seed + 4, n) * 6.28);
      else site.place(bay, x, z, place.yaw(yaw), { scale: [stretch, 1, 1] });
    }
  });
}
