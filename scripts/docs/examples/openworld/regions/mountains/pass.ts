/**
 * The mountain roads as the plan draws them (the pass and the secondary roads), dressed: a
 * tunnel portal at each end of every run bored through a ridge, orange snow poles along both
 * edges, and the pass top as a teleport and a car spawn. Nothing here moves a road.
 */
import type { Instance, LampLight, Marker, PropMesh, Road } from '../../plan/contract.ts';
import { placeLamps } from '../../props/index.ts';
import { beside, headingYaw, onGround, resample, tunnelRuns, type TunnelRun } from './route.ts';
import type { Placer } from './space.ts';
import { PORTAL_LAMPS, tunnelPortal } from './tunnel.ts';
import { EYE } from '../../build/markers.ts';

const POLE_EVERY = 50;

export type Pass = { props: PropMesh[]; lights: LampLight[]; markers: Marker[]; portals: number };

/** Road width rounded to the half metre: one portal mesh per width. */
const widthOf = (road: Road) => Math.round(road.width * 2) / 2;

/** Both portals of a run, facing out of it, or none: two that fit and stand clear of each other. */
function portalPair(placer: Placer, run: TunnelRun, id: string, n: number): Instance[] {
  const ends = [run.stations[0], run.stations[run.stations.length - 1]],
    [first, second] = ends.map((s, end) => {
      const [dx, dz] = end ? s.dir : [-s.dir[0], -s.dir[1]];
      return placer.fit(id, s.at[0], s.at[2], {
        y: s.at[1],
        yaw: headingYaw(dx, dz),
        onRoad: true,
        name: `mountains/${run.road.id}/tunnel-${n}/${end ? 'exit' : 'entry'}`,
      });
    });
  if (!first || !second) return [];
  const apart = Math.hypot(
    first.position[0] - second.position[0],
    first.position[2] - second.position[2],
  );
  return apart > 2 * placer.radius(id) ? [first, second].map((p) => placer.commit(p)) : [];
}

export function dressPass(placer: Placer, avoid: (x: number, z: number) => boolean): Pass {
  const pass: Pass = { props: [], lights: [], markers: [], portals: 0 },
    roads = placer.plan.roads.filter(
      (road) =>
        (road.class === 'pass' || road.class === 'secondary') &&
        road.points.some(([x, , z]) => placer.owns(x, z)),
    ),
    meshes = new Map<number, PropMesh>();
  for (const road of roads) {
    const w = widthOf(road),
      covered = new Set<number>();
    if (!meshes.has(w)) meshes.set(w, placer.register(tunnelPortal(w)));
    for (const [n, run] of tunnelRuns(placer.plan, road).entries()) {
      run.stations.forEach((s) => covered.add(s.along));
      for (const portal of portalPair(placer, run, meshes.get(w)!.id, n)) {
        pass.portals++;
        pass.lights.push(...placeLamps(PORTAL_LAMPS(w), portal));
      }
    }
    const stations = resample(road, 10);
    stations.forEach((s, i) => {
      if (i % (POLE_EVERY / 10) || covered.has(s.along)) return;
      for (const side of [1, -1] as const) {
        const [x, z] = beside(s, w / 2 + 1.2, side);
        // Not in a village, and not in the air beside a bridge deck.
        if (!avoid(x, z) && Math.abs(placer.plan.height(x, z) - s.at[1]) < 2)
          placer.place('mountains/snow-pole', x, z, { sink: 0.2, yaw: headingYaw(...s.dir) });
      }
    });
    const top = stations
      .filter(
        (s) =>
          !covered.has(s.along) && placer.owns(s.at[0], s.at[2], 50) && onGround(placer.plan, s.at),
      )
      .sort((a, b) => b.at[1] - a.at[1])[0];
    if (top && road.class === 'pass' && !pass.markers.length) {
      const [x, z] = beside(top, w / 2 + 4, 1);
      pass.markers.push(
        {
          kind: 'teleport',
          name: 'mountains/pass-top',
          position: [x, placer.plan.height(x, z) + EYE, z],
          yaw: headingYaw(...top.dir),
        },
        {
          kind: 'spawn',
          vehicle: 'car',
          name: 'mountains/pass-car',
          position: [...top.at],
          yaw: headingYaw(...top.dir),
        },
      );
    }
  }
  pass.props = [...meshes.values()];
  return pass;
}
