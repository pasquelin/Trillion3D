/**
 * Busy junctions (three arms or more beside downtown or mid-rise blocks) get traffic lights on
 * their corners and zebra crossings on their arms; the six central avenue segments get car
 * spawns in their right-hand lane.
 */
import type { Marker, Vec3 } from '../../plan/contract.ts';
import { IDS } from './catalog.ts';
import { facing, headingOf, turn, type Xz } from './frame.ts';
import { KERB } from './ground-props.ts';
import { gridPoint, key, type Cell } from './grid.ts';
import { RANK, type Placer } from './placement.ts';
import { at, busy, local, type Segment } from './segments.ts';
import { FOUNDATION } from './tower-kit.ts';

/** Traffic lights on the corners and zebra crossings on the arms of busy junctions. */
/** Furnishes the busy junctions; returns the street-level point of the most central one. */
export function junctions(placer: Placer, cells: Map<string, Cell>, all: Segment[]) {
  const arms = new Map<string, Xz[]>();
  let central: { point: Vec3; d: number } | undefined;
  for (const s of all) {
    const ends: [number, number, number][] =
      s.axis === 'h'
        ? [
            [s.i, s.j, 1],
            [s.i + 1, s.j, -1],
          ]
        : [
            [s.i, s.j, 1],
            [s.i, s.j + 1, -1],
          ];
    for (const [i, j, sign] of ends)
      arms.set(key(i, j), [...(arms.get(key(i, j)) ?? []), local(s.axis, sign, 0)]);
  }
  for (const [k, list] of arms) {
    const [i, j] = k.split(',').map(Number),
      around = [
        cells.get(key(i - 1, j - 1)),
        cells.get(key(i, j - 1)),
        cells.get(key(i - 1, j)),
        cells.get(key(i, j)),
      ];
    if (list.length < 3 || !around.some(busy)) continue;
    const { pitch, street, yaw } = placer.site,
      half = street / 2,
      centre = gridPoint(placer.site, [i * pitch, j * pitch]),
      d = Math.max(...around.map((cell) => cell?.d ?? Infinity));
    if (!central || d < central.d)
      central = { point: [centre[0], placer.site.plan.height(...centre), centre[1]], d };
    around.forEach((cell, c) => {
      if (!cell) return;
      const corner: Xz = [c % 2 ? 1 : -1, c > 1 ? 1 : -1],
        [x, z] = gridPoint(placer.site, [
          i * pitch + corner[0] * (half + 1.5),
          j * pitch + corner[1] * (half + 1.5),
        ]);
      placer.place(
        'traffic-light',
        [x, cell.base + KERB, z],
        headingOf(turn([0, corner[1]], yaw)),
        'solid',
        RANK.street,
        { centre: [x, z], half: [0.3, 0.3], yaw: 0 },
        { support: cell.base - FOUNDATION },
      );
    });
    for (const arm of list) {
      const dir = turn(arm, yaw),
        p: Xz = [centre[0] + dir[0] * (half + 3), centre[1] + dir[1] * (half + 3)],
        heading = headingOf(dir);
      placer.place(
        IDS.crossing,
        [p[0], placer.site.plan.height(p[0], p[1]) + 0.02, p[1]],
        heading,
        'road',
        RANK.furniture,
        { centre: p, half: [half, 1.5], yaw: heading },
      );
    }
  }
  return central?.point;
}

/** Six car spawns in the right-hand lane (driving toward +along) of the avenues nearest the centre. */
export function carSpawns(placer: Placer, all: Segment[]) {
  const { pitch, street } = placer.site,
    middle = (s: Segment) => at(placer, s.axis, s.i, s.j, pitch / 2, 0),
    [cx, , cz] = placer.site.city.centre,
    near = [...all].sort(
      (a, b) =>
        Math.hypot(middle(a)[0] - cx, middle(a)[1] - cz) -
        Math.hypot(middle(b)[0] - cx, middle(b)[1] - cz),
    );
  near.slice(0, 6).forEach((s, n) => {
    const [x, z] = at(
        placer,
        s.axis,
        s.i,
        s.j,
        pitch / 2,
        ((s.axis === 'h' ? 1 : -1) * street) / 4,
      ),
      dir = turn(local(s.axis, 1, 0), placer.site.yaw),
      spawn: Marker = {
        kind: 'spawn',
        vehicle: 'car',
        name: `city/car-${n}`,
        position: [x, placer.site.plan.height(x, z), z],
        yaw: facing(dir),
      };
    placer.markers.push(spawn);
  });
}
