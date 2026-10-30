# Physics

World option: [Jolt Physics](https://github.com/jrouwe/JoltPhysics) in a worker; a body = a mesh
with `physics` set. Module, worker, buffers: [ENGINE.md](engine/physics.md#physics);
cooked colliders: [COMPILER.md](COMPILER.md); SDK: [SDK.md](SDK.md).

```js
const world = createWorld('view', { physics: true }) // or world.physics.enabled = true
const floor = object.mesh(geometry.box(20, 1, 20), material.meshStandard({ physics: 'stone' }))
floor.physics = 'static'
const crate = object.mesh(geometry.box(1, 1, 1), material.meshStandard({ physics: 'wood' }))
crate.physics = 'dynamic'
crate.position.y = 5
world.scene.add(floor, crate)
crate.physics.on('contact', ({ other, impulse }) => console.log(other?.name, impulse))
```

Physics off: nothing fetched. First enable loads module and worker; earlier bodies are queued.

## World

`createWorld(canvas, { physics: { gravity, budget, simulationRange } })`; each is also a live
`world.physics` property.

| `world.physics.` | Type | Default | Refusal |
| - | - | - | - |
| `enabled` | boolean | `createWorld`'s `physics` | — |
| `gravity` | live vector, or `'earth'`, `'moon'`, `'mars'`, `'none'` | `'earth'` | — |
| `paused` | boolean | `false` | — |
| `timeScale` | number: 0.25 slow motion, 0 still | 1 | negative/infinite: `RangeError` |
| `simulationRange` | metres around camera where bodies simulate | `null`: follows `camera.far` | not `null` or finite > 0: `RangeError` |
| `water` | `{ level, waves, density, linearDrag, angularDrag, current }` or `null` | `null` | wave out of range: `RangeError` |
| `stats`, `error` | read only | — | — |

**Water.** Bodies under `water` are pushed by the weight of water displaced. Setting or removing
water wakes every dynamic body. `world.physics.waterSurface`: `height(x, z)`, `point(x, z, out)`,
`normal(x, z, out)`, `wavesNow()`. **Drawn water**: `sea.waves = world.physics.waterSurface`; `mesh.waves = null`
unlinks.

```js
world.physics.water = { level: 0, waves: [{ direction: [1, 0.25], wavelength: 44, amplitude: 0.55, steepness: 0.3 }] }
sea.waves = world.physics.waterSurface
```

## Bodies

`mesh.physics = 'static' | 'dynamic' | 'kinematic'` or options `{ type, mass, shape, gravityScale,
sensor, ccd, decorative, friction, restitution, damping, collision }`.
- **Shape** from geometry: box, sphere, capsule, cylinder = primitive (scaled); other mesh =
  triangles if static, convex hull if moving. Dynamic `{ type: 'triangles' }` refused. `{ type:
  'compound', parts }`: primitives with `position`, `quaternion`, one positive scale on all axes.
  `{ type: 'cylinder', halfHeight, radius, radiusBottom }` tapers from `radius` to `radiusBottom`,
  as `geometry.cylinder(radiusTop, radiusBottom, height)`. Unbuildable shape, or
  stretched/mirrored compound: `PHYSICS_FAILED` (mesh named).
- **Place.** Dynamic body = direct scene child (`PHYSICS_NESTED`). `position.set` teleports dynamic,
  drives kinematic there, pushing what it meets.
- **Mass, matter.** `mass` in kg, else material density × shape volume. Material `physics: 'wood' |
  'metal' | 'rubber' | 'ice' | 'stone' | 'glass'`, own `density`, `friction`, `restitution`; body
  `friction`, `restitution` override. `damping: { linear, angular }` = share
  of speed lost per second (`dv/dt = −c·v`; 0.05 default, 0 keeps all; negative: `RangeError`),
  set at creation. `mesh.physics.ccd = true` set later: motion quality changes at the next step.
- **Motion.** `mesh.physics.velocity` (read: last step's; write: launch), `applyImpulse(x, y, z)`,
  `wake()`, `asleep`.
- **Events.** `on('contact' | 'enter' | 'leave')` gives other object, impulse estimate, point;
  merged in body pair key order (`contactThreads.test.ts`).

## Collision channels and responses

Body = one of 64 channels; answers each channel `ignore`, `overlap` or `block`. Two bodies meet by
the lesser of the two answers: both block = collide; lesser overlap = pass through and report
(`enter` / `leave`); either ignores = no meeting. Channels 0–63, name or number:
eight engine's (`worldStatic`, `worldDynamic`, `pawn`, `visibility`, `camera`, `physicsBody`,
`vehicle`, `destructible`), six reserved (`engineTrace1`..`6`), fifty game's (`gameTrace1`..`50`).

`collision: { profile, objectType, responses, enabled }`. **Profile** sets object type and a
response per channel (unnamed = `block`): `NoCollision`, `BlockAll`, `OverlapAll`, `BlockAllDynamic`,
`OverlapAllDynamic`, `IgnoreOnlyPawn`, `OverlapOnlyPawn`, `Pawn`, `Spectator`, `CharacterMesh`,
`PhysicsActor`, `Destructible`, `InvisibleWall`, `InvisibleWallDynamic`, `Trigger`, `Ragdoll`,
`Vehicle`, `UI`. `responses` overrides channels, `objectType` the channel, `enabled` (`'noCollision'
| 'queryOnly' | 'physicsOnly' | 'queryAndPhysics'`); unsimulated = sensor. Left out: static `BlockAll`, dynamic `PhysicsActor`, kinematic
`BlockAllDynamic`, `sensor` `OverlapAllDynamic`, `decorative` debris `block` to `worldStatic`,
`ignore` to rest. Set at body creation.

```ts
// A trigger that only the pawn sets off, and a crate on a channel of the game's own.
door.physics = {
  type: 'static',
  sensor: true,
  collision: { profile: 'Trigger', responses: { pawn: 'overlap', physicsBody: 'ignore' } },
}
crate.physics = { collision: { objectType: 'gameTrace1', responses: { pawn: 'overlap' } } }
```

## Overlap queries

`await world.physics.overlap(shape, options)`: what a `sphere`, `box` or `capsule` meets at
`options.at` (`rotation`). `channel` (`{ objectType, responses }`, default visibility
channel, all blocked): by the rule above; `objectTypes: [...]`: every body of those channels. `mode`: `'multi'` (all, default), `'any'` (first met), `'blocking'` (first blocking);
`ignore` names a body to pass through. Answer `{ hits: { object, blocking, material }[], blocking }`,
engine-id order; physics off throws `PHYSICS_OFF`.

```ts
const { hits, blocking } = await world.physics.overlap(
  { type: 'box', halfExtents: { x: 1, y: 1, z: 1 } },
  { at: door.position, channel: { objectType: 'pawn' }, mode: 'multi' },
)
const anyCrate =
  (
    await world.physics.overlap(
      { type: 'sphere', radius: 2 },
      { at, objectTypes: ['physicsBody'], mode: 'any' },
    )
  ).hits.length > 0
```

## Joints

`joint.fixed | point | hinge | slider | distance | cone(a, b, options)` joins two bodies, or body
and world (`b` `null`); `world.physics.add(j)` / `remove(j)`.

| Option | Meaning |
| - | - |
| `anchor`, `anchorB` | connection points (distance: `anchor` end on `a`, `anchorB` on `b`); world point read at creation |
| `axis` | hinge pin, slider rail, cone middle |
| `limits: { min, max }` | radians for hinge (−π to π), metres for slider/distance (default: its length), half angle `max` for cone |
| `spring: { frequency, damping }` | softens stop of hinge, slider, distance |
| `motor: { mode: 'velocity' \| 'position', target, maxForce }` | drives hinge/slider, position measured from creation; `j.motor` changes it any time |
| `breakForce` | pull (N) past which joint breaks: `j.broken`, `j.on('break', fn)` |
| `breakTorque` | torque (N·m) past which it breaks (not on point, distance, pulley, gear, rack) |

Tuning a kind lacks (motor on fixed joint): `RangeError`.

**Advanced joints**, same `add`, `remove`, `breakForce`, `motor`:

- `joint.swingTwist` (shoulder): `axis` swings within cone half angle `limits.swing`, twists between
  `limits.min` and `max`; motor drives twist.
- `joint.sixDof`: `x` along `axis`, `y` nearest world up, `turnX | turnY | turnZ` about them, each
  locked unless `axes` frees (`'free'`) or limits (`{ min, max }`); `spring` softens slide limits,
  `motor.axis` names driven axis.
- `joint.path(a, b, { path, loop, follow })`: `a` runs along a smooth track through `path` points
  (≥2, fixed to `b` or world), turning with it unless `follow` is `false`; motor drives `a` at a
  speed or to a point (1.5 = halfway between 2nd and 3rd). On a track fixed to a moving body, each
  bend takes v²·dt / R² of kinetic energy per second.
- `joint.pulley(a, b, { over, ratio })`: `a`, `b` hang on one rope over two world wheels; rope 0 to
  its length unless `limits`.
- `joint.gear(a, b, { axis, axisB, ratio })`: `b` turns `ratio` times per turn of `a`, opposite way;
  `joint.rackAndPinion(pinion, rack, { axis, axisB, ratio })`: rack slides along `axisB` `1 / ratio`
  m per pinion radian. Each needs its own hinge or slider, body as `a`, same axis. Gears stay in
  phase when `ratio` or `1 / ratio` is whole, else may slip under load.

## Vehicles

`vehicle.car | motorcycle | tracked(body, { wheels, ...spec })` puts a dynamic body on wheels with the
module's vehicle constraint; `world.physics.add(v)` / `remove(v)`.

- **Wheels**: meshes, children of body, placed at their centre resting on flat ground, axle along
  body x; radius, width from bounds. Body faces −z; forward wheels steer.
- **Kinds.** Car: ≥3 wheels, `drive: 'front' | 'rear' | 'all'`, rear handbrake. Motorcycle: 2,
  rear-driven, leans. Tracked: ≥2 per side, steered by slowing one track.
- **Driving.** A vehicle is a `VehicleDriver`: `world.controls.vehicle = v` (keys,
  [Camera controllers](sdk/canvas-camera-and-teardown/camera-controllers.md#camera-controllers)),
  `v.drive(input)`. `v.speed` (m/s forward), `v.gear` (−1 reverse, 0 neutral), `v.rpm`.
- **Specs.** Defaults `VEHICLE_SPECS` (`packages/sdk-core/src/physics/vehicle/vehicleSpec.ts`); every
  number an option (`torquePerKg`, torque curve, gears, suspension, turning radius, ...).
- **Refusals** (`RangeError`): wheel not a body child, wrong wheel count, >6 gears, option its kind
  ignores (car: `trackTurn`, `maxLean`; motorcycle: `drive`, `trackTurn`, `antiRoll`; tracked:
  `clutch`, `drive`, `turnRadius`, `antiRoll`, `maxLean`), `suspensionTravel` not longer than sag
  `9.81 / (2π suspensionFrequency)²`.

## Soft bodies

`mesh.physics = { type: 'cloth' | 'rope' | 'volume', pins, mass, stretch, bend }`.

- **Shape.** Cloth = its triangles; rope = vertices in order; volume = closed, outward triangles
  held up by inside gas (`pressure`, Pa above air at rest). Same-position vertices are one. `pins` =
  vertex indices held in place.
- **Mass** by area (rope: length): 0.2 kg/m² (`SOFT_AREAL_DENSITY`), 0.065 kg/m
  (`SOFT_LINEAR_DENSITY`).
- **Stiffness.** `stretch`, `bend` = compliances (inverse stiffness); 0 never stretches, `Infinity`
  folds freely. Pinned cloth with `stretch` 0 keeps each free vertex within rest distance of nearest
  pin.
- **Pressure.** Default `SOFT_FOOTPRINT` (a quarter of mean cross-section), or the most its skin
  holds if less. Pressure past what skin holds within a tenth of rest volume throws `RangeError`.
  Compiled model volume reckoned at `PHYSICS_STEP`. Module bound (`soft.cpp`, `heldPressure`: `p ≤ v
  / (step · max(w · A / 3))`, `w` vertex inverse mass, `A` face area).
- **Options.** `friction`, `restitution`, `gravityScale`, `damping: { linear }` per vertex; `shape`,
  `sensor`, `ccd`, `decorative`, angular damping throw `RangeError`. No velocity, impulse, joint.
- **Damping.** None declared: `SOFT_DAMPING`, 0.603/s (`−ln(0.99)·60`); falls at most at
  `g / 0.603` (16.3 m/s); declared value wins, 0
  included.
- **Thickness.** Vertices keep 1 cm from contacts.
- **Start.** Free vertices offset up to a millionth of body size (`SOFT_IMPERFECTION`).
- **Bends.** Compliance floor ≥ a fifth of what the four vertices' masses give over a substep
  (`h²·Σ wᵢ|∇ᵢθ|²`), cooked bodies included.
- **Speed.** Vertex speed held under the faster of: fall from a hundred × body size under pull;
  `pull / damping`. Pull = gravity × its scale, never under 9.81 m/s².
- **Place.** Direct scene child. Moved >3 m at once: restarts at rest shape. Worker steps fixed
  1/60 s, ≤4 a frame. At another scale than made: refused
  (`PHYSICS_FAILED`) until back at that scale.
- **Support.** A static body that cloth near a pin starts inside (1 mm deep) is passed through.
- **Divergence.** Non-finite vertices or pose: body leaves simulation (last finite pose stays),
  joints break, `PHYSICS_DIVERGED` (mesh named). Page remakes it (`mesh.physics = ...`).
- **Collisions.** Rigid bodies collide with its vertices; character and soft bodies pass through.
  Events: point = mean of touching vertices.
- **Drawing.** `mesh.physics.vertices`: `x, y, z` per geometry vertex; geometry is dynamic
  ([Geometry rewritten every frame](sdk/canvas-camera-and-teardown/geometry-rewritten-every-frame.md#geometry-rewritten-every-frame)).
  Cooked soft bodies draw via `deformation/softSource.ts`, `soft/cookedSoft.ts`
  ([GPU deformation](engine/gpu-deformation.md#gpu-deformation)).

## Stillness, distance and view

Beyond `world.physics.simulationRange` a body freezes until it returns. Out of view: keeps falling.
`decorative` bodies meet static world only, simulate only in range and view, leave once asleep (set
`physics` again to resume), joints broken (`j.broken`, `'break'`).

## Budgets

`world.budget.physics` read at physics start; defaults `DEFAULT_PHYSICS_BUDGET`.

| Key | Default | Bounds |
| - | - | - |
| `bodies` | 16384 | bodies |
| `decorative` | 1024 | decorative bodies |
| `memoryBytes` | 128 MiB | module memory; half holds static collision; static mesh past it refused naming `memoryBytes` |
| `bodyPairs` | 65536 | body pairs per step |
| `contactConstraints` | 32768 | contacts per step |
| `contactEvents` | 4096 | contact events per step |
| `threads` | 8 | module thread pool incl. worker, on cross-origin isolated page (1 elsewhere), ≤ logical cores minus page's own |
| `softVertices` | 16384 (four 64 × 64 cloths) | all soft bodies' vertices at once |

| Case | Refusal |
| - | - |
| key not a budget | `PHYSICS_BUDGET` from `createWorld`; `TypeError` when added to `world.budget.physics` |
| request past one, or step finding more pairs/contacts than budgeted | `PHYSICS_BUDGET` on `world.physics.error` |
| soft body past `softVertices` | `PHYSICS_BUDGET` naming `softVertices` |
| `enter` past events budget | `stats.droppedEvents`; its `leave` never sent |

**Cost.** `stats.mainMs` = page's share; worker step = `stats.stepMs` (mean), `stats.stepMaxMs`.

## Compiled models

A model loaded by `scene.load()` collides with its own triangles (cook: `physics.json`,
[FORMAT.md](FORMAT.md)); tiles stream in around every moving body and the eye up to simulation
range, nearest first, within half of `budget.physics.memoryBytes`. Other format or engine-build cook:
`PHYSICS_FORMAT`; no cook: no collision. Tile or soft-body settings
the server refuses: `RESOURCE_HTTP_ERROR` on `world.physics.error`
([Files over HTTP](sdk/create-a-world.md#files-over-http)).

Tiles use source's `KHR_physics_rigid_bodies` collider, else `DEFAULT_MATTER`. Every drawn node is
static ground except one declaring a `motion`: its body as cooked, counted in `budget.physics`, with
motion's mass, centre of mass, inertia, else cooked ones.
Kinematic: follows its model, pushing what it meets. Dynamic: simulates; its subtree drawn where
simulation puts it. Partitioned model: body made when the cell drawing its node is placed, released
when cell leaves. Shape the module cannot make at body scale: `PHYSICS_FAILED` naming its node,
which stays static ground.

## Exact raycast

`await world.raycast(at, { exact: true })`: compiled model hit on cooked triangles (names model and
triangle's glTF `material`), body on its shape.

- `{ shape: { type: 'sphere', radius } }` (or `box` with `halfExtents`, `capsule` with `halfHeight`,
  `radius`) sweeps that shape.
- `maxDistance` defaults `camera.far`; `ignore` names a body to pass through.
- `channel` (`{ objectType, responses }`, default visibility channel, all blocked): stops at blockers.
- `objectTypes: [...]`: stops at bodies of those types, whatever they answer
  (`{ exact: true, objectTypes: ['worldStatic', 'worldDynamic'] }`: level and movable bodies,
  triggers included).

Without `exact` or `shape`, `world.raycast` uses the GPU ray query on drawn triangles
([Picking](sdk/canvas-camera-and-teardown/picking-moving-and-saving.md#picking-moving-and-saving)).
Physics off: `PHYSICS_OFF`.

## The character

`world.controls` `'character'`
([Camera controllers](sdk/canvas-camera-and-teardown/camera-controllers.md#camera-controllers)).

### Movement modes

Four `body.mode`s: `walking` on floor, `falling` in air, `swimming` in `world.physics.water`
(capsule centre under surface, `canSwim`), `flying` while `flying` set. Swimming/flying: wish in
three axes (head pitch, Space rises, C sinks), `fluidFriction` 0.3 (half flying, scaled by depth
swimming); `maxAcceleration` (20.48 m/s²) up to `swimSpeed` (3 m/s) or `flySpeed` (6 m/s);
`swimBraking`, `flyBraking` (0) slow it with no key; `buoyancy` (1) × depth lifts a swimmer.

**Crouch.** `canCrouch` (false): crouch key (C) shrinks capsule to `crouchedHeight` (0.8 m), walks
at `crouchedSpeed` (half walk), stands only where room allows; `crouchKeepsBase` (false) keeps
capsule base in place, else its centre.

**Walking and falling.** On floor velocity turns toward wish by `groundFriction` (8/s), gathers
`maxAcceleration` (20.48 m/s²) up to `walkSpeed` (6 m/s); no key: braked by friction doubled
(`brakingFrictionFactor` 2) and `brakingDecelerationWalking` (20.48 m/s²), in sub-steps of
`brakingSubStepTime` (1/33 s), stopped dead under 0.1 m/s. In air:
`fallingLateralFriction` (0), `brakingDecelerationFalling` (0); keys push with `airControl` (0.05),
× `airControlBoostMultiplier` (2) while sideways speed < `airControlBoostVelocityThreshold`
(0.25 m/s); fall held to `terminalVelocity` (40 m/s). Jump leaves at `jumpSpeed` (4.2 m/s). Tick cut
into sub-steps ≤ `maxSimulationTimeStep` (0.05 s), ≤ `maxSimulationIterations` (8);
`maxJumpApexAttemptsPerSimulation` (2). `minAnalogWalkSpeed` (0).

**Jumps.** Press read at next step's start: jumps if not crouched and fewer than
`jumpMaxCount` (1) jumps since last landing (a walk off an edge counts as used), leaving at ≥
`jumpSpeed`. With `jumpMaxHoldTime` (0) above zero the press stays while key held and keeps
`jumpSpeed` as least upward speed (`dontFallBelowJumpZVelocityDuringJump`, true), gravity pulling
meanwhile (`applyGravityWhileJumping`, true). Landing returns the jumps.

```ts
world.controls = 'character'
world.controls.groundFriction = 4 // a slippery floor: turns and brakes more gently
world.controls.airControl = 0.5 // steer a jump
world.controls.jumpMaxCount = 2 // a double jump
world.controls.canCrouch = true // C crouches
world.controls.flying = true // C sinks, Space rises, the head steers
```
