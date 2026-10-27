/**
 * The word layouts shared by the engine's physics worker and its WebAssembly module
 * (`packages/physics-jolt-wasm/src/binding.h`): the command buffer the page writes, the pose and
 * event records the module writes back. Every word is 32 bits, read as `uint32` or `float32` in
 * place. A change to any layout below bumps `PHYSICS_LAYOUT_VERSION` and the module with it.
 */
export const PHYSICS_LAYOUT_VERSION = 21

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
  /** The vehicles' (`vehicle/vehicleLayout.ts`). */ vehicle: 21,
  unvehicle: 22,
  drive: 23,
  /** The soft bodies' (`soft/softLayout.ts`). */ soft: 24,
  /** A collision filter, named by later ADDs (`FILTER_WORDS`). */ filter: 25,
} as const

/** How a body moves: fixed, moved by the page, or moved by the simulation. */
export const MOTION = { static: 0, kinematic: 1, dynamic: 2 } as const

/**
 * FILTER defines what a body is to the others: `op, id, object type, switches, block low, block
 * high, overlap low, overlap high` (`collisionChannels.ts`). The id is the page's; ADD names a body's
 * filter by it (the id is the Jolt object layer of the body, so the page keeps below
 * `MAX_FILTERS`). `switches` carries `FILTER_BIT`: the body takes part in the queries, in the
 * simulation, and does not move (a static body). The object type is a channel from 0 to 63; the
 * block and overlap masks are the channels the body blocks and overlaps, 64 bits each as two
 * words, the low word first. A filter is defined before any ADD that names it and never changes.
 * Two bodies meet by the lesser of what each answers to the other's channel: both block and they
 * collide, the lesser an overlap and they pass through each other and report it, either ignores
 * and they do not meet; a body that takes no part in the simulation is a sensor.
 */
export const FILTER_WORDS = 8
/** The word each field of a FILTER is at. */
export const FILTER_AT = {
  op: 0,
  id: 1,
  objectType: 2,
  switches: 3,
  block: 4,
  overlap: 6,
} as const
/**
 * The four filters the module knows from its start, so a page needs no FILTER for them: static
 * ground that blocks everything (`BlockAll`), a moving physics body (`PhysicsActor`), and debris
 * that meets the static ground alone, and the pawn the character is (`Pawn`). The page's own filters are numbered after them.
 */
export const BUILT_IN_FILTER = { static: 0, moving: 1, decorative: 2, pawn: 3 } as const
/** Filters the module holds: the object layers Jolt names (16 bits). */
export const MAX_FILTERS = 0x10000
/** The bits of a FILTER's switches. */
export const FILTER_BIT = { query: 1, physics: 2, still: 4 } as const

/** Shape kinds of the ADD command: four exact primitives, a triangle mesh, a convex hull, a
 *  cooked shape (`physics.json`), named by the handle a RESTORE gave it — its first data word —
 *  and scaled by `a, b, c`, and a compound of primitives. */
export const SHAPE = {
  box: 0,
  sphere: 1,
  capsule: 2,
  cylinder: 3,
  triangles: 4,
  hull: 5,
  cooked: 6,
  compound: 7,
} as const

/**
 * Words of one part of a compound: `kind, a, b, c, px, py, pz, qx, qy, qz, qw` — a primitive, its
 * sizes, its place in the body. A compound ADD carries its parts as data: `indexCount` counts
 * their words and `vertexCount` is 0.
 */
export const PART_WORDS = 11

/**
 * A scene query (`jolt_cast`): `kind, origin x, y, z, travel x, y, z, a, b, c, ignored, channel,
 * answer block low, high, answer overlap low, high, object types low, high, stop` — a ray, or a
 * sphere (radius `a`), box (half extents `a, b, c`) or capsule (half height `a`, radius `b`) swept
 * along `travel`, through the body whose engine id is `ignored` (`NO_INDEX`,
 * `../../../math/src/constants.ts`: none). What stops it is `stop` (`CAST_STOP`): by `channel`, what
 * blocks its channel as it answers channels (`FILTER_WORDS`); by `objectTypes`, the bodies whose
 * channel is among the object types (a mask of channels, two words), whatever they answer (an
 * overlap query's `objectTypes`). Its hit (`HIT_AT`): `engine id, fraction, point x, y, z, normal x,
 * y, z`; a miss names no body (`0xFFFFFFFF`). A tile's glTF material is its collider's, read from
 * `physics.json`.
 */
export const CAST_WORDS = 19
/** The word each field of a scene query is at: `origin`, `travel` and `extents` the first of their
 *  three words, `channel` of its five (the channel, the answers it blocks and overlaps) and
 *  `objectTypes` of its two. */
export const CAST_AT = {
  kind: 0,
  origin: 1,
  travel: 4,
  extents: 7,
  ignored: 10,
  channel: 11,
  objectTypes: 16,
  stop: 18,
} as const
/** What stops a scene query (`CAST_AT.stop`): what blocks its channel, or the bodies of its object types. */
export const CAST_STOP = { channel: 0, objectTypes: 1 } as const
export const HIT_WORDS = 8
/** The word each field of a scene query's hit is at: `point` and `normal` the first of their three words. */
export const HIT_AT = { body: 0, fraction: 1, point: 2, normal: 5 } as const
/** Words of RESTORE before its bytes (`op, handle, byteCount`), and of RELEASE (`op, handle`). */
export const RESTORE_WORDS = 3
export const RELEASE_WORDS = 2
export const CAST = { ray: 0, sphere: 1, box: 2, capsule: 3 } as const

/**
 * An overlap query (`jolt_overlap`): `mode, shape, a, b, c, position x, y, z, rotation x, y, z, w,
 * channel, answer block low, high, answer overlap low, high, object types low, high, ignored` — a
 * sphere (radius `a`), box (half extents `a, b, c`) or capsule (half height `a`, radius `b`) at a
 * place, asked with a channel and the answers it gives to channels (`mode` MULTI/ANY/BLOCKING by
 * channel) or with the object types it seeks (`mode` MULTI/ANY by object type), through the body
 * whose engine id is `ignored` (`NO_INDEX`: none). A body is met by the same rule two bodies are
 * (`FILTER_WORDS`): the lesser of what each answers to the other's channel, the query's channel and
 * answers being the body's own here; by object type it is met when its channel is among the types.
 * The reply is `hit count`, then per hit `engine id, flags, sub-shape`: flags `OVERLAP_HIT.blocking`
 * when the meeting is a block. ANY and BLOCKING stop at the first body met and list none of them (the
 * count is 1 or 0).
 */
export const OVERLAP_WORDS = 20
/** The word each field of an overlap query is at: `block`, `overlap` and `objectTypes` the first of
 *  their two words. */
export const OVERLAP_AT = {
  mode: 0,
  shape: 1,
  extents: 2,
  position: 5,
  rotation: 8,
  channel: 12,
  block: 13,
  overlap: 15,
  objectTypes: 17,
  ignored: 19,
} as const
export const OVERLAP_HIT_WORDS = 3
export const OVERLAP = { multi: 0, any: 1, blocking: 2, multiByObject: 3, anyByObject: 4 } as const
export const OVERLAP_HIT = { blocking: 1 } as const

/** Joint kinds of the JOINT command, each one of the module's two-body constraints. */
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
} as const
/** What a joint's motor does: nothing, drive to a velocity, or drive to a position. */
export const MOTOR = { off: 0, velocity: 1, position: 2 } as const
/**
 * Words of JOINT: `op, joint id, kind, engine id a, engine id b, motor mode, motor axis, extra
 * count`, then for `a` and for `b` its frame — `point x, y, z, axis x, y, z, normal x, y, z` in
 * that body's own frame, the world's when the engine id is `NO_INDEX` — then `limit min, limit max,
 * spring frequency, spring damping, motor target, motor max force, break force, break torque`, then the kind's
 * own `extra count` words: a swing-twist's swing half angle; a six-DOF's `min, max` per axis (`x,
 * y, z`, then turns about them; min +∞ locks one); a path's `loop, follow, point count` and per
 * point `position, tangent, normal` in `b`'s frame; a pulley's `ratio`, `a`'s wheel and `b`'s
 * wheel in the world; a gear's or a rack and pinion's `ratio`. The motor axis is the one a
 * six-DOF's motor drives, 0 to 5. The joint id is a slot and its generation, as a body's engine
 * id (`BODY_INDEX`). A joint whose body is gone is not made. UNJOINT is `op, joint id`; MOTOR is
 * `op, joint id, mode, axis, target, max force`. After a step, the module lists the joints pulled
 * past their break force or break torque and takes them out (`jolt_broken`).
 */
export const JOINT_WORDS = 34
export const UNJOINT_WORDS = 2
export const MOTOR_WORDS = 6

/** Per-body flag bits: sensor, continuous collision, events wanted, hidden (no pose), asleep (ADD),
 *  decorative (debris: simulated only in range and in view). */
export const FLAG = { sensor: 1, ccd: 2, events: 4, hidden: 8, asleep: 16, decorative: 32 } as const

/**
 * A body's engine id, carried by ADD and by every pose and event record: its slot in the bits of
 * `BODY_INDEX`, the slot's generation in the seven bits above. A record naming a body that left is
 * then never read as the body that took its slot; the other commands name the slot alone.
 */
export const BODY_INDEX = 0x00ffffff
/** Where the generation starts in an engine id, and how many a slot counts before wrapping. */
export const GENERATION_SHIFT = 24
export const GENERATIONS = 128
/** The engine id of slot `index` at `generation` (below `GENERATIONS`, so the id stays positive). */
export const engineId = (index: number, generation: number) =>
  index | (generation << GENERATION_SHIFT)

/**
 * Words of the fixed part of ADD: `op, engine id, motion, filter, shape, flags, px, py, pz, qx, qy,
 * qz, qw, a, b, c, mass, density, friction, restitution, gravityScale, linearDamping,
 * angularDamping, vertexCount, indexCount`, then `vertexCount × 3` floats and `indexCount` words.
 * `a, b, c` are a box's half extents; a sphere's radius; a capsule's or cylinder's half height,
 * radius and a tapered cylinder's bottom radius (0: none). A mass of 0 takes `density × volume`.
 * A primitive's 3 or 12 data words, a cooked shape's past its handle, are its mass frame: the
 * centre of mass it turns about, then a dynamic body's inertia about it (nine, column-major).
 */
export const ADD_WORDS = 25
/** The simulation's own damping, per second: what ADD carries for a body that sets none (the
 *  module's). Air costs a body a little of its speed; nothing slows its spin. */
export const LINEAR_DAMPING = 0.01
export const ANGULAR_DAMPING = 0

/**
 * Words of VIEW: `op, eye x, y, z, facing x, y, z, halfCone, range`. Distance decides what is
 * simulated: a dynamic body beyond `range` is frozen, its velocities kept. The view decides what is
 * sent: a body outside the cone of half angle `halfCone` (radians; 0 sees everything) sends no pose.
 */
export const VIEW_WORDS = 9

/**
 * Words of one piece `jolt_water_query` lists: `engine id, index | count << 16, x, z, half x,
 * half z` — a compound's sub-shape, a slice of a long primitive or the whole body, by its centre
 * and horizontal half extents in world space.
 */
export const WATER_PIECE_WORDS = 6
/**
 * Words of BUOYANCY before its planes: `op, plane count, water density, linear drag, angular
 * drag, current x, y, z`, then per piece `PLANE_WORDS` words: `engine id, index | count << 16,
 * point x, y, z, normal x, y, z` — the water plane under that piece. A body's pieces are
 * consecutive.
 */
export const BUOYANCY_WORDS = 8
export const PLANE_WORDS = 8

/**
 * Words of one pose record: `engine id | asleep bit, px, py, pz, qx, qy, qz, qw, vx, vy, vz, wx, wy,
 * wz` — the linear and angular velocities let the page extrapolate a late tick.
 */
export const POSE_WORDS = 14
/** Set on a pose record's index word when the body fell asleep during the step. */
export const ASLEEP_BIT = 0x80000000

/** Words of one event record: `type, engine id a, engine id b, impulse, px, py, pz`. */
export const EVENT_WORDS = 7
/** Event types: a pair of bodies started touching, or stopped. */
export const EVENT = { begin: 1, end: 2 } as const

/** What `jolt_error` answers after a failed step. */
export const MODULE_ERROR = ['NONE', 'BODY_LIMIT', 'UNKNOWN_BODY', 'BAD_SHAPE', 'BAD_COMMAND']

/**
 * Words of CHARACTER: `op, radius, height, maxSlope, stepHeight, mass, pushStrength, feet x, y, z,
 * filter, crouched height, crouch keeps base`. It puts the world's one character at rest with its
 * feet there, replacing any before; a radius of 0 removes it. The character is the object type and
 * answers of its `filter` (`FILTER_WORDS`); the crouched height is the capsule's total height when
 * crouched, and a crouch keeps the capsule's base in place when `crouch keeps base` is 1 and its
 * centre in place otherwise.
 */
export const CHARACTER_WORDS = 13
/**
 * Words of CHARACTER_MOVE: `op, vx, vy, vz, grounded, crouch` — the velocity the character moves at
 * over the next step, in m/s, whether it walks (it then climbs steps and follows the floor down) and
 * whether it wishes to be crouched (it stands again only where the room is).
 */
export const CHARACTER_MOVE_WORDS = 6
/**
 * Words of the character's state after a step: `present, feet x, y, z, ground, ground velocity
 * x, y, z, crouched`; `ground` is `GROUND`, the ground velocity that of the point it stands on;
 * `crouched` is 1 while the capsule is the crouched one.
 */
export const CHARACTER_STATE_WORDS = 9
/** What the character stands on: a floor, a slope too steep, a touch that holds nothing, air. */
export const GROUND = { floor: 0, steep: 1, unsupported: 2, air: 3 } as const
