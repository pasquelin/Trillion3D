/**
 * The word layouts shared by the engine's physics worker and its WebAssembly module
 * (`packages/physics-jolt-wasm/src/binding.h`): the command buffer the page writes, the pose and
 * event records the module writes back. Every word is 32 bits, read as `uint32` or `float32` in
 * place. A change to any layout below bumps `PHYSICS_LAYOUT_VERSION` and the module with it.
 */
export const PHYSICS_LAYOUT_VERSION = 4;

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
} as const;

/** How a body moves: fixed, moved by the page, or moved by the simulation. */
export const MOTION = { static: 0, kinematic: 1, dynamic: 2 } as const;

/**
 * Collision layers. Static geometry meets everything that moves; moving bodies meet everything;
 * decorative bodies (debris) meet the static world only, so a thousand of them never push a
 * character or a crate.
 */
export const LAYER = { static: 0, moving: 1, decorative: 2 } as const;

/** Shape kinds of the ADD command: four exact primitives, a triangle mesh, a convex hull. */
export const SHAPE = { box: 0, sphere: 1, capsule: 2, cylinder: 3, triangles: 4, hull: 5 } as const;

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
 * qz, qw, a, b, c, mass, density, friction, restitution, gravityScale, vertexCount, indexCount`,
 * followed by `vertexCount × 3` floats and `indexCount` indices. `a, b, c` are the primitive's
 * sizes (box half extents; sphere radius; capsule and cylinder half height, radius); a mass of 0
 * takes `density × volume`.
 */
export const ADD_WORDS = 23;

/**
 * Words of VIEW: `op, eye x, y, z, facing x, y, z, halfCone, range`. Distance decides what is
 * simulated: a dynamic body beyond `range` is frozen, its velocities kept. The view decides what is
 * sent: a body outside the cone of half angle `halfCone` (radians; 0 sees everything) sends no pose.
 */
export const VIEW_WORDS = 9;

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
 * x, y, z`; `ground` is `GROUND`, the ground velocity that of the point it stands on.
 */
export const CHARACTER_STATE_WORDS = 8;
/** What the character stands on: a floor, a slope too steep, a touch that holds nothing, air. */
export const GROUND = { floor: 0, steep: 1, unsupported: 2, air: 3 } as const;
