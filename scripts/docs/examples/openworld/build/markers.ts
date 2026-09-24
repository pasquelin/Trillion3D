/**
 * Where a teleport or a spawn may stand (#332): its footprint (`footprint.ts`) crosses no solid
 * triangle of the physics (`solids.ts`) above what a foot steps up, and its feet rest on the
 * ground (or a solid a step above it), a boat on the sea, or a marker that declares a `deck` on
 * the solid surface under it. `settle` moves a marker that fails to the nearest spot that
 * passes, along a fixed spiral, still facing what it was put there for.
 */
import {
  WORLD,
  type Instance,
  type Marker,
  type PropMesh,
  type WorldPlan,
} from '../plan/contract.ts';
import { FOOT } from '../../../../../site/examples/kit/openworld/play/sim/foot.ts';
import { solidColliders, type SolidColliders } from './colliders.ts';
import { crosses, footprintOf } from './footprint.ts';
import { solidIndex } from './solids.ts';

/** Eye height of a standing person, metres: a teleport puts the eye there. */
export const EYE = FOOT.eye;
/** How far feet may sit from the ground or a deck, and how high a solid under them may rise: the
 * walker's step. */
export const FOOTING = FOOT.stepUp;
/** The spiral's pitch and reach, metres. */
const PITCH = 1;
const REACH = 120;

type Standing = Extract<Marker, { kind: 'teleport' | 'spawn' }>;
const isStanding = (marker: Marker): marker is Standing => marker.kind !== 'emitter';
const isBoat = (marker: Standing) => marker.kind === 'spawn' && marker.vehicle === 'boat';
const feetOf = (marker: Standing) => marker.position[1] - (marker.kind === 'teleport' ? EYE : 0);

/** Offsets on a PITCH grid, nearest first, ties broken by angle: the same spiral every time. */
const SPIRAL = (() => {
  const n = REACH / PITCH,
    list: [number, number][] = [];
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) if (i * i + j * j <= n * n) list.push([i * PITCH, j * PITCH]);
  const key = ([x, z]: [number, number]) => [x * x + z * z, Math.atan2(z, x)];
  return list.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
})();

export type MarkerWorld = {
  plan: WorldPlan;
  meshes: readonly PropMesh[];
  instances: readonly Instance[];
  /** The solids already built from `meshes` and `instances`, when the caller has them. */
  solids?: SolidColliders;
};

export function markerSite({ plan, meshes, instances, solids }: MarkerWorld) {
  const { near, over } = solidIndex(solids ?? solidColliders(meshes, instances));
  const blocker = (marker: Standing, x: number, feet: number, z: number) => {
    const print = footprintOf(marker),
      clear = isBoat(marker) ? print.low : FOOTING;
    return near(x, z, print.radius).find((solid) =>
      crosses(solid, print, { x, feet, z, yaw: marker.yaw }, clear),
    );
  };
  /** The first solid surface over feet at (x, feet, z) beyond a step; it faces up inside a solid. */
  const above = (x: number, feet: number, z: number) =>
    over(x, z).find((surface) => surface.y > feet + FOOTING);
  const inside = (x: number, feet: number, z: number) => above(x, feet, z)?.up === true;
  /** The highest solid surface feet at `feet` stand on or step up to. */
  const stepTop = (x: number, feet: number, z: number) =>
    over(x, z).findLast((surface) => surface.y <= feet + FOOTING)?.y;
  /** The deck feet at `feet` stand on: the top of the solid they are in, else `stepTop`. */
  const deckTop = (x: number, feet: number, z: number) =>
    inside(x, feet, z) ? above(x, feet, z)!.y : stepTop(x, feet, z);
  /** The ground a walker stands on: the terrain, or a solid a step above it (a plinth). */
  const groundAt = (x: number, z: number) =>
    Math.max(plan.height(x, z), stepTop(x, plan.height(x, z), z) ?? -Infinity);
  const onFooting = (marker: Standing, x: number, feet: number, z: number) => {
    if (isBoat(marker))
      return Math.abs(feet - WORLD.seaLevel) <= FOOTING && plan.height(x, z) < WORLD.seaLevel;
    if (inside(x, feet, z)) return false;
    return (
      Math.abs(feet - groundAt(x, z)) <= FOOTING ||
      (marker.deck === true && Math.abs((deckTop(x, feet, z) ?? Infinity) - feet) <= FOOTING)
    );
  };

  /** Why the marker cannot stand where it is, or undefined when it can. */
  function problem(marker: Standing) {
    const [x, , z] = marker.position,
      feet = feetOf(marker),
      box = blocker(marker, x, feet, z);
    if (box)
      return `${marker.name}: crosses ${box.prop} at ${box.corners.slice(0, 3).map(Math.round)}`;
    if (!onFooting(marker, x, feet, z))
      return `${marker.name}: feet at ${feet.toFixed(2)}, ground at ${plan.height(x, z).toFixed(2)}`;
    return undefined;
  }

  /**
   * The marker itself when it passes, else the nearest spot on its own footing that does: the
   * ground, the sea for a boat, or the deck it declares, feet on that deck's top. A ground marker
   * put in or on a building comes down beside it, a teleport turned back to face it, a vehicle
   * keeping its heading; one off its ground with nothing in the way is its region's fault, left
   * for the check to report.
   */
  function settle(marker: Standing): Standing {
    const [x0, , z0] = marker.position,
      declared = feetOf(marker);
    if (!problem(marker)) return marker;
    const box = marker.deck ? undefined : blocker(marker, x0, declared, z0),
      landmark =
        inside(x0, declared, z0) ||
        (deckTop(x0, declared, z0) ?? -Infinity) > groundAt(x0, z0) + FOOTING ||
        (box !== undefined && over(x0, z0).length > 0),
      lift = marker.kind === 'teleport' ? EYE : 0;
    if (!marker.deck && !landmark && !onFooting(marker, x0, declared, z0)) return marker;
    const footing = (x: number, z: number) =>
      isBoat(marker) ? WORLD.seaLevel : marker.deck ? deckTop(x, declared, z) : groundAt(x, z);
    for (const [dx, dz] of SPIRAL) {
      const x = x0 + dx,
        z = z0 + dz,
        feet = footing(x, z),
        turn = landmark && marker.kind === 'teleport' && (dx || dz),
        moved = { ...marker, yaw: turn ? Math.atan2(-dx, -dz) : marker.yaw };
      if (feet === undefined || blocker(moved, x, feet, z) || !onFooting(moved, x, feet, z))
        continue;
      return { ...moved, position: [x, feet + lift, z] };
    }
    return marker;
  }

  return { problem, settle };
}

/** Every teleport and spawn moved to where it can stand; other markers as they were. */
export function settleMarkers(world: MarkerWorld, markers: readonly Marker[]) {
  const { settle } = markerSite(world);
  return markers.map((marker) => (isStanding(marker) ? settle(marker) : marker));
}

/** One line per teleport or spawn that cannot stand where it is. */
export function markerProblems(world: MarkerWorld, markers: readonly Marker[]) {
  const { problem } = markerSite(world);
  return markers.filter(isStanding).flatMap((marker) => problem(marker) ?? []);
}
