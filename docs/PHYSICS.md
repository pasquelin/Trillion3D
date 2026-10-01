# Physics

Physics is an option of the world, not a second world: [Jolt
Physics](https://github.com/jrouwe/JoltPhysics) runs in a worker, and every body is an ordinary mesh
with `physics` set. The module, the worker and its buffers are [ENGINE.md](ENGINE.md#physics), the
cooked colliders [COMPILER.md](COMPILER.md), the rest of the SDK [SDK.md](SDK.md).

```js
const world = createWorld('view', { physics: true }); // or world.physics.enabled = true
const floor = object.mesh(geometry.box(20, 1, 20), material.meshStandard({ physics: 'stone' }));
floor.physics = 'static';
const crate = object.mesh(geometry.box(1, 1, 1), material.meshStandard({ physics: 'wood' }));
crate.physics = 'dynamic';
crate.position.y = 5;
world.scene.add(floor, crate);
crate.physics.on('contact', ({ other, impulse }) => console.log(other?.name, impulse));
```

Without physics, no byte of Jolt or its page code is fetched; they and the worker's WebAssembly
module load when physics is first enabled, bodies set before queued.

## World

`createWorld(canvas, { physics: { gravity, budget, simulationRange } })` sets them at creation;
each is also a live property of `world.physics`.

| `world.physics.` | Type | Default | Refusal |
| --- | --- | --- | --- |
| `enabled` | boolean | `createWorld`'s `physics` | — |
| `gravity` | a live vector, or `'earth'`, `'moon'`, `'mars'`, `'none'` | `'earth'` | — |
| `paused` | boolean | `false` | — |
| `timeScale` | number: 0.25 is slow motion, 0 stands still | 1 | negative or infinite: `RangeError` |
| `simulationRange` | metres around the camera within which bodies are simulated | `null`: follows `camera.far` | anything but `null` or a finite distance above 0: `RangeError` |
| `water` | `{ level, waves, density, linearDrag, angularDrag, current }` or `null` | `null` | a wave out of range: `RangeError` |
| `stats`, `error` | read only | — | — |

**Water.** Each step the worker fits a plane of the waves to every piece under `water` and pushes it
by the weight of water displaced, so a body lighter than water floats; the drags set how fast it
settles, never where; setting or removing water wakes every dynamic body.
`world.physics.waterSurface` reads the same waves at the simulation's time, to draw them (running
while bodies sleep, still when paused): `height(x, z)`, `point(x, z, out)` (where a grid's rest
point is carried), `normal(x, z, out)`, `wavesNow()` (the waves with their phases, so water set
again goes on from there). Example: [floating crates](../site/examples/floating-crates.html), its
sea uploaded in place every frame (#573).

## Bodies

`mesh.physics = 'static' | 'dynamic' | 'kinematic'` or options `{ type, mass, shape, gravityScale,
sensor, ccd, decorative, friction, restitution, damping }`.

- **Shape**, read from the geometry: a box, sphere, capsule or cylinder is that exact primitive
  (scaled); any other mesh its triangles when static, its convex hull (computed in the worker) when
  it moves. A dynamic `{ type: 'triangles' }` is refused (no volume, no mass). `{ type: 'compound',
  parts }` is one rigid body of primitives, each with `position` and `quaternion` in the object's
  frame, under one positive scale on all axes. A declared `{ type: 'cylinder', halfHeight, radius,
  radiusBottom }` tapers from its top's `radius` to `radiusBottom`, as
  `geometry.cylinder(radiusTop, radiusBottom, height)` draws it. A shape the worker cannot build,
  or a stretched or mirrored compound, fails that body alone (`PHYSICS_FAILED`, the mesh named).
- **Place.** A dynamic body is a direct child of the scene (`PHYSICS_NESTED`). `position.set`
  teleports a dynamic body and drives a kinematic one there over the next step, pushing what it
  meets.
- **Mass and matter.** `mass` in kilograms, else the material's density times the shape's volume. A
  material carries `physics: 'wood' | 'metal' | 'rubber' | 'ice' | 'stone' | 'glass'` and its own
  `density`, `friction` and `restitution` over the preset; a body's `friction` and `restitution`
  override both. `damping: { linear, angular }` is the share of speed lost each second
  (`dv/dt = −c·v`; 0.05 each by default, 0 keeps it all, negative throws `RangeError`), set at
  creation like `sensor`: a body's own air and rolling loss
  ([ride a roller coaster](../site/examples/ride-a-roller-coaster.html)).
- **Motion.** `mesh.physics.velocity` (read: the last step's; written: a launch),
  `applyImpulse(x, y, z)`, `wake()`, `asleep`.
- **Events.** `on('contact' | 'enter' | 'leave')` gives the other object, an impulse estimate
  (approach speed times the pair's reduced mass) and the point. After `Update`, contact records
  merge in a canonical order no thread decides: by body pair key (lower engine index first), each
  pair's events as Jolt ran them — not Jolt's callback order. A full buffer's carried `leave` events
  and a removed body's come before the merge, a soft body's after it. Any pool size gives the single
  thread's order (`contactThreads.test.ts`).

## Joints

`joint.fixed | point | hinge | slider | distance | cone(a, b, options)` joins two bodies, or a body
and the world (`b` is `null`), with Jolt's constraints; `world.physics.add(j)` and `remove(j)` put
it in and out. It exists while both bodies are simulated, made again when one returns.

| Option | Meaning |
| --- | --- |
| `anchor`, `anchorB` | where they connect (a distance: `anchor` the end on `a`, `anchorB` on `b`); a world point read when the joint is made, then kept in each body's frame |
| `axis` | the hinge's pin, the slider's rail, the cone's middle; read and kept as `anchor` |
| `limits: { min, max }` | radians for a hinge (−π to π), metres for a slider or a distance (default: its length), the half angle `max` for a cone |
| `spring: { frequency, damping }` | makes the stop of a hinge, slider or distance soft. |
| `motor: { mode: 'velocity' \| 'position', target, maxForce }` | drives a hinge or slider, position measured from where the joint was made; `j.motor` changes it any time |
| `breakForce` | pull in newtons past which the joint breaks after a step: `j.broken` turns true, `j.on('break', fn)` is called, the bodies part |

A tuning a kind lacks (a motor on a fixed joint) throws `RangeError`. Example:
[hinges and joints](../site/examples/hinges-and-joints.html).

**Advanced joints**, with the same `add`, `remove`, `breakForce` and `motor`:

- `joint.swingTwist`, a shoulder: `axis` swings within a cone of half angle `limits.swing`, twists
  between `limits.min` and `max`; the motor drives the twist.
- `joint.sixDof`: axes `x` along `axis`, `y` as near world up as it can, `turnX | turnY | turnZ`
  about them, each locked unless `axes` frees (`'free'`) or limits it (`{ min, max }`); `spring`
  softens slide limits, `motor.axis` names the driven axis.
- `joint.path(a, b, { path, loop, follow })` runs `a` along a smooth track through `path`'s points
  (at least two, fixed to `b` or the world), turning with it unless `follow` is `false`; the motor
  drives `a` at a speed, or to a point (1.5: halfway between the second and the third). A track
  fixed in the world does no work: bends turn `a` without slowing it, and an undamped body keeps its
  energy to within one step of gravity's work. Not on a track fixed to a moving body, nor for a body
  held off its centre while it spins: there each bend takes v²·dt / R² of its kinetic energy per
  second (v speed, R bend radius, dt the step).
- `joint.pulley(a, b, { over, ratio })` hangs `a` and `b` on one rope over two world wheels, the
  rope from 0 to its length unless `limits` says otherwise.
- `joint.gear(a, b, { axis, axisB, ratio })` turns `b` `ratio` times per turn of `a` (`a`'s teeth
  over `b`'s), the other way round; `joint.rackAndPinion(pinion, rack, { axis, axisB, ratio })`
  slides the rack along `axisB` by `1 / ratio` metres per pinion radian (`ratio` is 1 / its radius).
  Each gear, pinion and rack needs its own hinge or slider, the body as its `a`, about the same
  axis; Jolt reads them to keep the teeth in phase over any run: always for a rack and pinion; for a
  gear when `ratio` or `1 / ratio` is whole (it wraps each hinge's angle to one turn); any other
  gear ties speeds only and may slip a fraction of a tooth under load. Example: [gears and
  pulleys](../site/examples/gears-and-pulleys.html).

## Vehicles

`vehicle.car | motorcycle | tracked(body, { wheels, ...spec })` puts a dynamic body on wheels with
Jolt's vehicle constraint — engine, automatic gearbox, differentials, suspension, anti-roll bars;
`world.physics.add(v)` makes it once its body is simulated, `remove(v)` leaves the body wheelless.

- **Wheels** are meshes, children of the body, placed at their centre as they rest on flat ground,
  axle along the body's x; radius and width come from their bounds, and each tick turns, steers and
  lifts them on the suspension.
- **Body.** As in Jolt's vehicle samples, the centre of mass is lowered to the shape's bottom,
  midway between the wheels, and restored when the vehicle leaves. While a vehicle, its running gear
  is solid: a box over the wheels' footprint, from the body's bottom to their lowest point raised by
  the suspension travel, joins its shape, so no body slips under it among the wheels (Jolt only
  casts them); mass and inertia stay the shape's. The body faces −z; the forward wheels steer.
- **Kinds.** A car: three wheels or more, one differential per driven axle
  (`drive: 'front' | 'rear' | 'all'`), handbrake on the rear. A motorcycle: two, rear-driven,
  leaning into turns. A tracked vehicle: two or more a side, each track driven by its rearmost
  wheel, steered by slowing one track, pivoting on the spot at a standstill.
- **Driving.** A vehicle is a `VehicleDriver`: `world.controls.vehicle = v` drives it with the keys
  ([Camera controllers](SDK.md#camera-controllers)), `v.drive(input)` from code. The brake stops it,
  then backs it up; the throttle first stops one rolling back. Parked — not driven since it was
  made or last stood still — it holds its brakes, so it rests on a slope and sleeps (#831).
  `v.speed` (m/s forward), `v.gear` (−1
  reverse, 0 neutral) and `v.rpm` read the last step.
- **Specs.** Each kind is a real machine (`VEHICLE_SPECS`: a Corvette C5, a Yamaha XJ900, an M1
  Abrams), every number sourced in `vehicleSpec.ts`, each an option: torque per body kilogram
  (`torquePerKg`), torque curve, idle and redline, gear ratios, shift points and final drive,
  suspension frequency, damping and travel, anti-roll bars, the turning radius the steering lock
  derives from, the time a hand takes to full lock, brake grip, a motorcycle's lean, a track's turn.
- **Refusals** (`RangeError`): a wheel not a child of the body, a wrong wheel count, more than six
  gears, an option its kind ignores (a car's `trackTurn` or `maxLean`; a motorcycle's `drive`,
  `trackTurn` or `antiRoll`; a tracked vehicle's `clutch`, `drive`, `turnRadius`, `antiRoll` or
  `maxLean`), a `suspensionTravel` not longer than its sag, `9.81 / (2π suspensionFrequency)²`.

Example: [drive a car](../site/examples/drive-a-car.html).

## Soft bodies

`mesh.physics = { type: 'cloth' | 'rope' | 'volume', pins, mass, stretch, bend }` simulates each
vertex on Jolt's soft bodies.

- **Shape.** A cloth is its triangles; a rope its vertices in order, each joined to the next; a
  volume its closed, outward triangles held up by the gas inside (`pressure`, Pa above the air's at
  rest, rising when squeezed). Vertices at one position are one (a sphere's seam never tears).
  `pins` are vertex indices held in place.
- **Mass**, spread by the area (a rope: the length) each vertex holds; by default a medium woven
  cotton (`SOFT_AREAL_DENSITY`, 0.2 kg/m²) or a 10 mm polyamide rope (`SOFT_LINEAR_DENSITY`,
  0.065 kg/m).
- **Stiffness.** `stretch` and `bend` are compliances, the inverse of stiffness, for a pulled edge
  and a bent fold (Jolt's defaults: 0 never stretches, `Infinity` folds freely). A pinned cloth with
  `stretch` 0 keeps each free vertex within its rest distance of the nearest pin (Jolt's long range
  attachments), so a large one never stretches without end; one given stretch keeps its give.
- **Pressure.** A volume's default rests its weight on a quarter of its mean cross-section
  (`SOFT_FOOTPRINT`, declared), or the most its skin holds if less. A pressure past what the skin
  holds within a tenth of its rest volume throws `RangeError`: edges give by their `stretch` and by
  the solver's own compliance (a substep squared over a vertex's mass), so a light, finely cut skin
  holds less.
- **Options.** `friction`, `restitution`, `gravityScale` and `damping: { linear }` act per vertex as
  on a rigid body; `shape`, `sensor`, `ccd`, `decorative` and angular damping throw `RangeError`
  (vertices do not turn). No velocity, impulse, joint or vehicle.
- **Place.** A direct child of the scene; moved by the page, it is carried with its vertices, its
  simulation kept; placed at another scale than it was made at, it is refused (`PHYSICS_FAILED`)
  and leaves the simulation until back at that scale (Jolt scales no soft body once made), as a
  compiled model's cooked one does; hidden, its vertices are not sent.
- **Divergence.** A body, soft or rigid, whose vertices or pose go non-finite sends none: it keeps
  its last finite one on screen and leaves the simulation with `PHYSICS_DIVERGED` (the mesh named).
- **Collisions.** Rigid bodies and the character collide with its vertices: the character is turned
  aside or stopped, never pushing it; a rigid body much heavier than the skin can push between its
  vertices; soft bodies pass through each other (Jolt collides them with rigid bodies only).
  `on('contact' | 'enter' | 'leave')` works on either side, from Jolt's soft-body contact listener:
  the point is the mean of the touching vertices, the impulse estimated from their mean velocity and
  mass, a pair stays entered while both rest; a sensor reports without stopping it.
- **Drawing.** `mesh.physics.vertices` reads the vertices as the last tick left them, `x, y, z` per
  geometry vertex in the geometry's frame; the geometry is dynamic, drawn where the last step left
  it ([Geometry rewritten every frame](SDK.md#geometry-rewritten-every-frame), #573).

## Stillness, distance and view

A sleeping body sends nothing; once all sleep, the worker stops ticking and no frame is drawn.
Beyond `world.physics.simulationRange` a body freezes, velocities kept, until it returns. Out of
view or hidden it sends no pose but keeps falling (its pose on falling asleep is sent). `decorative`
bodies meet the static world only, are simulated only in range and view, and leave once asleep, the
mesh resting in place (set `physics` again to resume), their joints broken (`j.broken`, `'break'`).

## Budgets

`world.budget.physics` is read when physics starts; defaults are `DEFAULT_PHYSICS_BUDGET`.

| Key | Default | Bounds |
| --- | --- | --- |
| `bodies` | 16384 | bodies |
| `decorative` | 1024 | decorative bodies |
| `memoryBytes` | 128 MiB | a hard ceiling on the module's memory; half holds the static collision, a static triangle mesh past it refused naming `memoryBytes` |
| `bodyPairs` | 65536 | body pairs per step |
| `contactConstraints` | 32768 | contacts per step |
| `contactEvents` | 4096 | contact events per step |
| `threads` | 8 | Jolt's thread pool, the worker's included, on a cross-origin isolated page (one elsewhere), at most the logical cores minus the page's own; the worker times its steps and uses fewer threads while more only contend; Jolt computes the same step on any count |
| `softVertices` | 16384 (four cloths of 64 × 64) | every soft body's vertices at once |

| Case | Refusal |
| --- | --- |
| a key that is no budget (the removed `triangles`) | `PHYSICS_BUDGET` from `createWorld`, a `TypeError` when added to `world.budget.physics` |
| a request past one, or a step finding more pairs or contacts than budgeted | `PHYSICS_BUDGET` on `world.physics.error` |
| a soft body past `softVertices` | `PHYSICS_BUDGET` naming `softVertices` |
| an `enter` past the events budget | counted in `stats.droppedEvents`; its `leave` is never sent |

Every soft vertex is solved each step, so the step grows linearly with them: the R&D audit measured
6.5–8.2 ms a step at the default and 2.4–2.8 ms at 4096 (four of 32 × 32), natively on one thread
(#975); a page needing fewer lowers it.

**Cost.** The `physics` CPU stage is the page's share (`stats.mainMs`); the worker's step is
`stats.stepMs` (mean of the last tick's steps) and `stats.stepMaxMs` (its slowest), on its own
clock: never added together.

## Compiled models

A model loaded with `scene.load()` collides with its own triangles once physics is on: the compiler
cooked them (`physics.json`, [FORMAT.md](FORMAT.md)), and tiles stream in from Jolt's binary state
around every moving body and the eye up to the simulation range, nearest first, within half of
`budget.physics.memoryBytes`, leaving as they move away (a tile stays until half as far again as it
came in). No scene is refused for its size: a tile that does not fit waits, the farthest leaving for
it. Another format or Jolt's cook is refused (`PHYSICS_FORMAT`); a model compiled before the cook
collides nowhere. A tile or a soft body's settings the server refuses is `RESOURCE_HTTP_ERROR` on
`world.physics.error` ([Files over HTTP](SDK.md#files-over-http)); a model leaving the scene drops
its pending reads, no error.

Tiles grip and bounce as the source's `KHR_physics_rigid_bodies` collider declares, else with
`DEFAULT_MATTER`. Every drawn node is static ground but one declaring a `motion`: its body is
restored as cooked (implicit shape, or fetched hull), counted in `budget.physics`, with its motion's
mass, centre of mass and inertia, else the cooked ones (cooked inertia moved to a declared centre);
its tiles, and those of a node its collider is made from, leave. A kinematic one follows its model,
pushing what it meets (under a dynamic one, as that body carries its node); a dynamic one simulates,
its node and what hangs under it drawn where the simulation puts them, that subtree's tiles leaving
and ground streaming in around it; moved by the page with its model or node, it is put where the
node is then drawn. In a partitioned model, whose cache numbers nodes otherwise, it is held
kinematic and asleep where drawn. A shape Jolt cannot make at the body's scale is `PHYSICS_FAILED`
naming its node, which stays static ground; a body refused at a rescale is made again at another
scale.

## Exact raycast

`await world.raycast(at, { exact: true })` asks the physics: a compiled model is hit on its cooked
triangles (naming the model and the triangle's glTF `material`), a body on its shape.
`{ shape: { type: 'sphere', radius } }` (or `box` with `halfExtents`, `capsule` with `halfHeight`
and `radius`) sweeps that shape; `maxDistance` defaults to `camera.far`; `ignore` names a body to
pass through, the asker's own. Without `exact` or `shape`, `world.raycast` answers at once from the
scene's geometry, a model on its box ([Picking](SDK.md#picking-moving-and-saving)). With physics
off, an exact raycast throws `PHYSICS_OFF`.

## The character

With physics on, `world.controls` `'character'` is the physics' own character: it pushes, rides and
is pushed ([Camera controllers](SDK.md#camera-controllers)).

## Measured, and what remains

`ten-thousand-bodies` (10,000 boxes landing at once; headed Chrome, 1280×720, DPR 1, cross-origin
isolated, eight threads, 120 Hz display; load average 8–14, not a quiet machine; commit f56d2dd57;
three runs): worker step 3.7–4.2 ms p50, 20–25 ms p95 during the landing, which then runs in slow
motion for a moment; page `physics` stage 0.40 ms p50, 0.59–0.71 ms p95 a frame; rAF interval
8.8–10.4 ms p50, 10–13.4 ms p99. The renderer's work for 10,000 moved instances is measured apart
(#432). Joints, advanced joints, vehicles, cooked colliders and soft bodies are not measured at
this scale. Destruction, ragdolls and clothes on an animated character remain (#399).
