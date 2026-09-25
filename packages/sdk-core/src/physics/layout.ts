/**
 * The word layouts shared by the engine's physics worker and its WebAssembly module
 * (`packages/physics-jolt-wasm/src/binding.h`): the command buffer the page writes, the pose and
 * event records the module writes back. Every word is 32 bits, read as `uint32` or `float32` in
 * place. A change to any layout below bumps `PHYSICS_LAYOUT_VERSION` and the module with it.
 */
export const PHYSICS_LAYOUT_VERSION = 13;

/** Command opcodes, the first word of each command. */
export const OP = {
  add: 1,
  remove: 2,
  teleport: 3,
  moveKinematic: 4,
  velocity: 5,
  impulse: 6,
  wake: 7,
  gravity: 8,
  gravityScale: 9,
  view: 10,
  flags: 11,
  material: 12,
  character: 13,
  characterMove: 14,
  restore: 15,
  release: 16,
  buoyancy: 17,
  joint: 18,
  unjoint: 19,
  motor: 20,
  /** The vehicles' (`vehicleLayout.ts`). */ vehicle: 21,
  unvehicle: 22,
  drive: 23,
  /** The soft bodies' (`softLayout.ts`). */ soft: 24,
} as const;

/** How a body moves: fixed, moved by the page, or moved by the simulation. */
export const MOTION = { static: 0, kinematic: 1, dynamic: 2 } as const;

/**
 * Collision layers. Static geometry meets everything that moves; moving bodies meet everything;
 * decorative bodies (debris) meet the static world only, so a thousand of them never push a
 * character or a crate.
 */
export const LAYER = { static: 0, moving: 1, decorative: 2 } as const;

/** Shape kinds of the ADD command: four exact primitives, a triangle mesh, a convex hull, a
 *  cooked shape (`physics.json`), named by the handle a RESTORE gave it — its one data word — and
 *  scaled by `a, b, c`, and a compound of primitives. */
export const SHAPE = {
  box: 0,
  sphere: 1,
  capsule: 2,
  cylinder: 3,
  triangles: 4,
  hull: 5,
  cooked: 6,
  compound: 7,
} as const;

/**
 * Words of one part of a compound: `kind, a, b, c, px, py, pz, qx, qy, qz, qw` — a primitive, its
 * sizes, its place in the body. A compound ADD carries its parts as data: `indexCount` counts
 * their words and `vertexCount` is 0.
 */
export const PART_WORDS = 11;

/**
 * Words of RESTORE before its bytes: `op, handle, byteCount`, then the shape's Jolt binary state
 * padded to whole words. RELEASE is `op, handle`: bodies built from the shape keep it.
 */
export const RESTORE_WORDS = 3;

/**
 * A scene query (`jolt_cast`): `kind, origin x, y, z, travel x, y, z, a, b, c` — a ray, or a
 * sphere (radius `a`), box (half extents `a, b, c`) or capsule (half height `a`, radius `b`) swept
 * along `travel`. Its hit: `engine id, fraction, point x, y, z, normal x, y, z`; a miss names no
 * body (`0xFFFFFFFF`). A tile's glTF material is its collider's, read from `physics.json`.
 */
export const CAST_WORDS = 10;
export const HIT_WORDS = 8;
export const CAST = { ray: 0, sphere: 1, box: 2, capsule: 3 } as const;
export const MISS = 0xffffffff;

/** Joint kinds of the JOINT command, each one of Jolt's two-body constraints. */
export const JOINT = {
  fixed: 0,
  point: 1,
  hinge: 2,
  slider: 3,
  distance: 4,
  cone: 5,
  swingTwist: 6,
  sixDof: 7,
  path: 8,
  pulley: 9,
  gear: 10,
  rackAndPinion: 11,
} as const;
/** What a joint's motor does: nothing, drive to a velocity, or drive to a position. */
export const MOTOR = { off: 0, velocity: 1, position: 2 } as const;
/**
 * Words of JOINT: `op, joint id, kind, engine id a, engine id b, motor mode, motor axis, extra
 * count`, then for `a` and for `b` its frame — `point x, y, z, axis x, y, z, normal x, y, z` in
 * that body's own frame, the world's when the engine id is `MISS` — then `limit min, limit max,
 * spring frequency, spring damping, motor target, motor max force, break force`, then the kind's
 * own `extra count` words: a swing-twist's swing half angle; a six-DOF's `min, max` per axis (`x,
 * y, z`, then turns about them; min +∞ locks one); a path's `loop, follow, point count` and per
 * point `position, tangent, normal` in `b`'s frame; a pulley's `ratio`, `a`'s wheel and `b`'s
 * wheel in the world; a gear's or a rack and pinion's `ratio`. The motor axis is the one a
 * six-DOF's motor drives, 0 to 5. The joint id is a slot and its generation, as a body's engine
 * id (`BODY_INDEX`). A joint whose body is gone is not made. UNJOINT is `op, joint id`; MOTOR is
 * `op, joint id, mode, axis, target, max force`. After a step, the module lists the joints pulled
 * past their break force and takes them out (`jolt_broken`).
 */
export const JOINT_WORDS = 33;

/** Per-body flag bits: sensor, continuous collision, contact events wanted, hidden (no pose). */
export const FLAG = { sensor: 1, ccd: 2, events: 4, hidden: 8 } as const;

/**
 * A body's engine id, carried by ADD and by every pose and event record: its slot in the bits of
 * `BODY_INDEX`, the slot's generation in the seven bits above. A record naming a body that left is
 * then never read as the body that took its slot; the other commands name the slot alone.
 */
export const BODY_INDEX = 0x00ffffff;
/** Where the generation starts in an engine id, and how many a slot counts before wrapping. */
export const GENERATION_SHIFT = 24;
export const GENERATIONS = 128;

/**
 * Words of the fixed part of ADD: `op, engine id, motion, layer, shape, flags, px, py, pz, qx, qy,
 * qz, qw, a, b, c, mass, density, friction, restitution, gravityScale, linearDamping,
 * angularDamping, vertexCount, indexCount`,
 * followed by `vertexCount × 3` floats and `indexCount` indices. `a, b, c` are the primitive's
 * sizes (box half extents; sphere radius; capsule and cylinder half height, radius); a mass of 0
 * takes `density × volume`.
 */
export const ADD_WORDS = 25;
/** The simulation's own damping, per second, linear and angular alike: what ADD carries for a
 *  body that sets none (Jolt's). */
export const DAMPING = 0.05;

/**
 * Words of VIEW: `op, eye x, y, z, facing x, y, z, halfCone, range`. Distance decides what is
 * simulated: a dynamic body beyond `range` is frozen, its velocities kept. The view decides what is
 * sent: a body outside the cone of half angle `halfCone` (radians; 0 sees everything) sends no pose.
 */
export const VIEW_WORDS = 9;

/**
 * Words of one piece `jolt_water_query` lists: `engine id, index | count << 16, x, z, half x,
 * half z` — a compound's sub-shape, a slice of a long primitive or the whole body, by its centre
 * and horizontal half extents in world space.
 */
export const WATER_PIECE_WORDS = 6;
/**
 * Words of BUOYANCY before its planes: `op, plane count, water density, linear drag, angular
 * drag, current x, y, z`, then per piece `PLANE_WORDS` words: `engine id, index | count << 16,
 * point x, y, z, normal x, y, z` — the water plane under that piece. A body's pieces are
 * consecutive.
 */
export const BUOYANCY_WORDS = 8;
export const PLANE_WORDS = 8;

/**
 * Words of one pose record: `engine id | asleep bit, px, py, pz, qx, qy, qz, qw, vx, vy, vz, wx, wy,
 * wz` — the linear and angular velocities let the page extrapolate a late tick.
 */
export const POSE_WORDS = 14;
/** Set on a pose record's index word when the body fell asleep during the step. */
export const ASLEEP_BIT = 0x80000000;

/** Words of one event record: `type, engine id a, engine id b, impulse, px, py, pz`. */
export const EVENT_WORDS = 7;
/** Event types: a pair of bodies started touching, or stopped. */
export const EVENT = { begin: 1, end: 2 } as const;

/** What `jolt_error` answers after a failed step. */
export const MODULE_ERROR = ['NONE', 'BODY_LIMIT', 'UNKNOWN_BODY', 'BAD_SHAPE', 'BAD_COMMAND'];

/**
 * Words of CHARACTER: `op, radius, height, maxSlope, stepHeight, mass, pushStrength, feet x, y, z`.
 * It puts the world's one character at rest with its feet there, replacing any before; a radius
 * of 0 removes it.
 */
export const CHARACTER_WORDS = 10;
/**
 * Words of CHARACTER_MOVE: `op, vx, vy, vz, grounded` — the velocity the character moves at over
 * the next step, in m/s, and whether it walks (it then climbs steps and follows the floor down).
 */
export const CHARACTER_MOVE_WORDS = 5;
/**
 * Words of the character's state after a step: `present, feet x, y, z, ground, ground velocity
 * x, y, z, ground friction`; `ground` is `GROUND`, the ground velocity that of the point it stands
 * on, the ground friction that of the body it stands on (`material.physics`), -1 when none.
 */
export const CHARACTER_STATE_WORDS = 9;
/** What the character stands on: a floor, a slope too steep, a touch that holds nothing, air. */
export const GROUND = { floor: 0, steep: 1, unsupported: 2, air: 3 } as const;
