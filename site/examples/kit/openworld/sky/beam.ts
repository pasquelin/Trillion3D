import type {
  Marker,
  Mover,
} from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import type { MaterialLike, NodeLike, SkyEngine } from './engine.ts';

type Beacon = Extract<Mover, { kind: 'beacon' }>;
type Emitter = Extract<Marker, { kind: 'emitter' }>;

/** The beacon an emitter belongs to: the nearest one, the lantern the region placed it on. */
function nearestBeacon(emitter: Emitter, beacons: readonly Beacon[]): Beacon | null {
  let best: Beacon | null = null;
  let distance = Infinity;
  for (const beacon of beacons) {
    const d = Math.hypot(
      beacon.position[0] - emitter.position[0],
      beacon.position[1] - emitter.position[1],
      beacon.position[2] - emitter.position[2],
    );
    if (d < distance) [best, distance] = [beacon, d];
  }
  return best;
}

/** The beam's heading, radians about +Y, after `seconds` at the beacon's turning rate. */
export const beamHeading = (beacon: Beacon, seconds: number) =>
  ((beacon.rpm * seconds) / 60) * 2 * Math.PI;

export type Beams = {
  node: NodeLike;
  /** Turns every beam with its beacon and fades them in with the night. */
  update(seconds: number, nightFactor: number): void;
};

/**
 * The visible cone of each lighthouse beam: an open, additive cone from the lantern out to
 * the beacon's range, whose far radius is the emitter's radius, turning with its beacon.
 * Light scattered by the air along the beam is what makes it visible; without fog in the
 * engine, the cone stands for it.
 */
export function createBeams(
  engine: SkyEngine,
  emitters: readonly Emitter[],
  movers: readonly Mover[],
): Beams {
  const beacons = movers.filter((mover): mover is Beacon => mover.kind === 'beacon');
  const node = engine.object.group();
  const material: MaterialLike = engine.material.meshBasic({
    color: '#fff2cc',
    transparent: true,
    opacity: 0,
    blending: engine.blending.additive,
    side: engine.side.double,
    depthWrite: false,
  });
  const turning: { pivot: NodeLike; beacon: Beacon }[] = [];
  for (const emitter of emitters) {
    const beacon = nearestBeacon(emitter, beacons);
    if (!beacon) continue;
    const cone = engine.object.mesh(
      engine.geometry.cone(emitter.radius, beacon.range, 24, 1, true),
      material,
    );
    // The cone's apex is at +height/2 on +Y: laid along +X, its apex sits on the lantern.
    cone.rotation.set(0, 0, Math.PI / 2);
    cone.position.set(beacon.range / 2, 0, 0);
    const pivot = engine.object.group();
    pivot.position.set(beacon.position[0], beacon.position[1], beacon.position[2]);
    pivot.add(cone);
    node.add(pivot);
    turning.push({ pivot, beacon });
  }
  let shown = -1;
  return {
    node,
    update(seconds, nightFactor) {
      for (const { pivot, beacon } of turning)
        pivot.rotation.set(0, beamHeading(beacon, seconds), 0);
      // Written only when it moves by a visible step, never every frame.
      const step = Math.round(nightFactor * 16) / 16;
      if (step === shown) return;
      // Not derived: the share of the lantern's light the air sends back along the beam, which
      // needs the engine's fog to compute; a quarter reads as a beam without hiding the sea.
      material.opacity = step * 0.25;
      node.visible = step > 0;
      shown = step;
    },
  };
}
