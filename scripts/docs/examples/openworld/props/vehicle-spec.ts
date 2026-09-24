/**
 * Vehicles as plain data. The page moves them every frame, so a vehicle is a small JSON-able
 * list of parametric parts the page rebuilds with the engine's own `geometry` family (box,
 * cylinder, cone, sphere, torus, lathe, extrude with bevel), plus the named anchors physics
 * needs (wheels, eye, lamps, spinner). The triangles come from the parameters (`segments`,
 * `bevel`, `smooth`, `repeat`), never from shipped vertex lists. The same data becomes a static
 * `PropMesh` for parked and traffic copies (`vehicle-parts.ts`).
 *
 * Frame: metres, +Y up, the nose toward +Z, so +X is the vehicle's left. The origin is on the
 * ground under the centre of the wheelbase (cars) or under the centre of gravity (aircraft).
 */
import type { Surface, Vec3 } from '../plan/contract.ts';
import type { PropLamp } from './lamps.ts';

/** What the page animates on a part; a part without a role is rigid body. */
export type PartRole = 'wheel' | 'propeller' | 'rotor' | 'tail-rotor';

/**
 * One parametric part, placed by `rotation` (`[x, y, z]` radians, applied Z, then X, then Y:
 * Euler order "YXZ") and then `position`.
 * - `box`, `rounded-box`, `sphere`: centred; `size` is the full extent. `bevel` rounds a box's
 *   edges (m) in `segments` steps.
 * - `cylinder`, `cone`: axis along Y, centred; `size` = [diameter x, height, diameter z];
 *   `taper` = top radius / bottom radius; `segments` around.
 * - `torus`: axis along Y, centred; `size` is its bounding box — outer diameter in x and z, tube
 *   diameter in y; `segments` around the ring.
 * - `lathe`: `profile` of `[radius, y]` metres turned about Y, then scaled by `size`.
 * - `extrude`: `outline` of `[x, y]` metres (corners cut `smooth` times by Chaikin's rule),
 *   extruded along Z over `depth` centred on z = 0, rims rounded by `bevel` in `segments` steps,
 *   the solid inside outline and depth; then scaled by `size`.
 * `repeat` places `count` copies, copy i moved by i × `step` and turned by i × `turn.angle`
 * about the vehicle-frame axis through `turn.pivot` (spokes, windows, rotor blades).
 */
export type VehiclePart = {
  shape: 'box' | 'rounded-box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'lathe' | 'extrude';
  size: Vec3;
  position: Vec3;
  rotation?: Vec3;
  /** A key of the spec's `surfaces`. */
  surface: string;
  segments?: number;
  bevel?: number;
  taper?: number;
  profile?: readonly (readonly [number, number])[];
  outline?: readonly (readonly [number, number])[];
  depth?: number;
  smooth?: number;
  repeat?: {
    count: number;
    step?: Vec3;
    turn?: { axis: 'x' | 'y' | 'z'; pivot: Vec3; angle: number };
  };
  role?: PartRole;
  /** Which anchor a moving part belongs to (the wheel index). */
  anchor?: number;
};

export type WheelAnchor = {
  /** Wheel centre in the vehicle frame; the axle runs along X. */
  position: Vec3;
  radius: number;
  width: number;
  steers: boolean;
  drives: boolean;
};

export type VehicleSpec = {
  id: string;
  kind: 'car' | 'van' | 'truck' | 'bus' | 'plane' | 'airliner' | 'helicopter';
  /** Kilograms, a real vehicle of that class loaded to half. */
  mass: number;
  /** Measured bounds of every part, `[min, max]` in the vehicle frame (`withBounds`). */
  bounds: readonly [Vec3, Vec3];
  surfaces: Record<string, Surface>;
  parts: readonly VehiclePart[];
  anchors: {
    wheels: readonly WheelAnchor[];
    /** Driver's or pilot's eye, for the first-person and cockpit cameras. */
    eye: Vec3;
    /** Where a chase camera looks from, behind and above. */
    chase: Vec3;
    /** Headlights and landing lights, lit at night by the page. */
    lamps: readonly PropLamp[];
    /** Propeller or rotor hub and its spin axis. */
    spinner?: { position: Vec3; axis: Vec3; radius: number };
    /** Jet or exhaust outlets, for the effects the page draws behind them. */
    exhausts?: readonly Vec3[];
  };
};

/** A spec drafted without bounds, measured from its own parts (`withBounds`). */
export type VehicleDraft = Omit<VehicleSpec, 'bounds'>;
