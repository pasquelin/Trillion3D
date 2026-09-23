/**
 * The streets between the cells: a local avenue wherever a built block borders a grid line and
 * the plan has none there (never through the stadium, never over water). Along every line, the
 * plan's avenues included: street lamps about every 30 m, street trees downtown, and at busy
 * junctions traffic lights and zebra crossings. Pedestrians walk the pavements beside streets and
 * avenues (the play layer's rule), so no walk is exported. Car spawns sit in the central lanes.
 */
import { STREET_LAMP_LIGHTS } from '../../props/index.ts';
import { sidewaysOf, turn, type Xz } from './frame.ts';
import { KERB } from './ground-props.ts';
import type { Cell } from './grid.ts';
import { carSpawns, junctions } from './junctions.ts';
import { RANK, type Placer } from './placement.ts';
import { at, busy, ground, local, segments, type Segment } from './segments.ts';
import { FOUNDATION } from './tower-kit.ts';

/** Lays and furnishes the streets; returns the most central busy junction, at street level. */
export function layStreets(placer: Placer, cells: Map<string, Cell>) {
  const all = segments(placer, cells),
    { pitch, street, yaw } = placer.site;
  for (const s of all) {
    const points = [0, 0.5, 1].map((t) =>
      ground(placer, at(placer, s.axis, s.i, s.j, t * pitch, 0)),
    );
    // Where the plan already runs an avenue, the city only furnishes it.
    const [mx, , mz] = points[1];
    if (!placer.site.roads.hits({ centre: [mx, mz], half: [0.5, 0.5], yaw: 0 }).length)
      placer.addRoad(
        { id: `city/avenue-${s.axis}${s.i}_${s.j}`, class: 'avenue', width: street, points },
        true,
      );
    s.sides.forEach(
      (cell, k) =>
        cell && furnish(placer, s, cell, k ? 1 : -1, turn(local(s.axis, 0, k ? -1 : 1), yaw)),
    );
  }
  carSpawns(placer, all);
  return junctions(placer, cells, all);
}

/** Lamps about every 30 m (staggered on suburban streets), and street trees downtown. */
function furnish(placer: Placer, s: Segment, cell: Cell, sign: number, toRoad: Xz) {
  const y = cell.base + KERB,
    support = cell.base - FOUNDATION,
    half = placer.site.street / 2,
    count = Math.max(1, Math.round(placer.site.pitch / 30)),
    step = placer.site.pitch / count,
    suburb = !busy(cell) && cell.district !== 'park';
  for (let n = 0; n < count; n++) {
    if (suburb && (n % 2 === 0) !== sign > 0) continue;
    const [x, z] = at(placer, s.axis, s.i, s.j, (n + 0.5) * step, sign * (half + 1));
    placer.place(
      'street-lamp',
      [x, y, z],
      sidewaysOf(toRoad),
      'solid',
      RANK.street,
      { centre: [x, z], half: [0.3, 0.3], yaw: 0 },
      { lamps: STREET_LAMP_LIGHTS, support },
    );
  }
  if (!busy(cell)) return;
  for (let n = 1; n < count; n++) {
    const [x, z] = at(placer, s.axis, s.i, s.j, n * step, sign * (half + 3));
    placer.place(
      'tree-oak-small',
      [x, y, z],
      n + s.i,
      'solid',
      RANK.garden,
      { centre: [x, z], half: [0.6, 0.6], yaw: 0 },
      { support },
    );
  }
}
