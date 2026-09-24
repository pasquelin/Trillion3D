/**
 * What each cell holds. Downtown: one tower per block, taller toward the centre — the landmark
 * supertall on the central block, the helipad slab beside it — with rooftop equipment and
 * benches on the plaza. Mid-rise: four apartment blocks around a courtyard, neon signs on some
 * shop fronts. Suburb: eight fenced garden lots with a house and a tree. Park: lawns, paths, a
 * fountain, benches, big trees. Stadium: the bowl on its superblock and four floodlight masts.
 */
import type { Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { IDS, type CityCatalog } from './catalog.ts';
import { facing, headingOf, turn } from './frame.ts';
import { KERB } from './ground-props.ts';
import { footprint, inCell, RINGS, superblock, type Cell } from './grid.ts';
import { FLOOD_LAMPS } from './floodlight.ts';
import { RANK, type Placer } from './placement.ts';
import { house, midriseBlock } from './lots.ts';
import { rooftop } from './mounts.ts';
import { park } from './park.ts';
import { FOUNDATION } from './tower-kit.ts';

export function fillCells(
  placer: Placer,
  cells: Map<string, Cell>,
  catalog: CityCatalog,
  seed: number,
) {
  const ordered = [...cells.values()].sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  let downtown = 0,
    deck: Vec3 | undefined;
  for (const cell of ordered) {
    const y = cell.base + KERB,
      support = cell.base - FOUNDATION;
    if (cell.district === 'stadium') {
      if (cell.group === `${cell.i},${cell.j}`) stadium(placer, cell, catalog);
      continue;
    }
    const base =
      cell.district === 'suburb' ? IDS.suburb : cell.district === 'park' ? IDS.park : IDS.paved;
    const plinth = placer.place(
      base,
      [cell.box.centre[0], cell.base, cell.box.centre[1]],
      placer.site.yaw,
      'flat',
      RANK.structure,
      cell.box,
      { support },
    );
    if (!plinth) continue;
    if (cell.district === 'downtown') deck = tower(placer, cell, catalog, downtown++, seed) ?? deck;
    else if (cell.district === 'midrise') midriseBlock(placer, cell, catalog, seed);
    else if (cell.district === 'park') park(placer, cell, y, support);
    else for (let lot = 0; lot < 8; lot++) house(placer, cell, catalog, lot, seed);
  }
  return deck;
}

/**
 * The central block holds the tallest round tower, the next the tallest slab with the helipad
 * and the rooftop viewpoint; farther blocks draw an archetype and step down in height with
 * distance, so the skyline peaks at the centre.
 */
function tower(placer: Placer, cell: Cell, catalog: CityCatalog, rank: number, seed: number) {
  const list = catalog.tower,
    byHeight = [...list].sort((a, b) => b.height - a.height),
    // Three quarters of the rank comes from the distance, one quarter from the draw.
    t = Math.min(0.999, (cell.d / RINGS.downtown) * 0.75 + hash01(seed, cell.i, cell.j) * 0.25),
    pick =
      [
        list.find((x) => x.prop.id === 'city/tower-round-310')!,
        list.find((x) => x.prop.id === 'city/tower-slab-230')!,
      ][rank] ?? byHeight[Math.floor(t * byHeight.length)];
  const quarter = hash01(seed + 2, cell.i, cell.j) < 0.5 ? 0 : Math.PI / 2,
    yaw = placer.site.yaw + quarter,
    y = cell.base + KERB,
    at = inCell(placer, cell, [0, 0], y);
  const item = placer.place(
    pick.prop.id,
    at,
    yaw,
    'solid',
    RANK.structure,
    footprint(placer, cell, [0, 0], pick.half, quarter),
    {
      support: y - FOUNDATION,
    },
  );
  if (!item) return undefined;
  for (const [u, v] of [
    [-38, -38],
    [38, -38],
    [-38, 38],
    [38, 38],
  ] as const)
    placer.place(
      'bench',
      inCell(placer, cell, [u, v], y),
      headingOf(turn([-u, -v], placer.site.yaw)),
      'solid',
      RANK.furniture,
      footprint(placer, cell, [u, v], [1, 1]),
      { support: cell.base - FOUNDATION },
    );
  return pick.roof ? rooftop(placer, at, yaw, pick.roof, rank === 1) : undefined;
}

/** The stadium on its superblock plinth, four floodlight masts at the plinth's corners. */
function stadium(placer: Placer, cell: Cell, catalog: CityCatalog) {
  const plinth = superblock(placer.site, cell),
    whole = { box: plinth },
    y = cell.base + KERB,
    support = cell.base - FOUNDATION;
  if (
    !placer.place(
      IDS.superblock,
      [plinth.centre[0], cell.base, plinth.centre[1]],
      placer.site.yaw,
      'flat',
      RANK.structure,
      plinth,
      { support },
    )
  )
    return;
  placer.place(
    catalog.stadium.prop.id,
    inCell(placer, whole, [0, 0], y),
    placer.site.yaw,
    'solid',
    RANK.structure,
    footprint(placer, whole, [0, 0], catalog.stadium.half),
    { support: y - FOUNDATION },
  );
  for (const [u, v] of [
    [-98, -98],
    [98, -98],
    [-98, 98],
    [98, 98],
  ] as const)
    placer.place(
      'city/flood-mast',
      inCell(placer, whole, [u, v], y),
      headingOf(turn([-u, -v], placer.site.yaw)),
      'solid',
      RANK.street,
      footprint(placer, whole, [u, v], [0.6, 0.6]),
      { lamps: FLOOD_LAMPS, support },
    );
  placer.markers.push({
    kind: 'teleport',
    name: 'city/stadium',
    position: inCell(placer, whole, [0, -70], y + 26),
    yaw: facing(turn([0, 1], placer.site.yaw)),
    pitch: -0.3,
  });
}
