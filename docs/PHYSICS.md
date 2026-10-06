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

Without physics, no byte of the physics module or its page code is fetched; they and the worker's
WebAssembly module load when physics is first enabled, bodies set before queued.

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
`world.physics.waterSurface` reads the same waves at the simulation's time (running while bodies
sleep, still when paused): `height(x, z)`, `point(x, z, out)` (where a grid's rest point is
carried), `normal(x, z, out)`, `wavesNow()` (the waves with their phases, so water set again goes
on from there); set again, the water is the same surface, carried by the new waves. **Drawn
water**: a mesh that lies flat on the water at its `level` — a plane turned flat and placed there,
its world box flat to a float32 step — is the water's surface: the engine sets its `mesh.waves` to
`waterSurface` and the GPU moves each vertex where the waves carry it, on the physics' clock, with
no vertex written on the page; moved off the level, it is released. A body, or a geometry the
page rewrites (`usage: 'dynamic'`), is never carried, and `mesh.waves = null` (or a surface of the
page's own) keeps a mesh out. Example: [floating
crates](../site/examples/floating-crates.html).

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
  pair's events as the simulation ran them — not the engine's callback order. A full buffer's
  carried `leave` events and a removed body's come before the merge, a soft body's after it. Any
  pool size gives the single thread's order (`contactThreads.test.ts`).

## Joints

`joint.fixed | point | hinge | slider | distance | cone(a, b, options)` joins two bodies, or a body
and the world (`b` is `null`), with the module's constraints; `world.physics.add(j)` and `remove(j)`
put it in and out. It exists while both bodies are simulated, made again when one returns.

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
  axis; the simulation reads them to keep the teeth in phase over any run: always for a rack and
  pinion; for a gear when `ratio` or `1 / ratio` is whole (it wraps each hinge's angle to one turn);
  any other gear ties speeds only and may slip a fraction of a tooth under load. Example: [gears and
  pulleys](../site/examples/gears-and-pulleys.html).

## Vehicles

`vehicle.car | motorcycle | tracked(body, { wheels, ...spec })` puts a dynamic body on wheels with
the module's vehicle constraint — engine, automatic gearbox, differentials, suspension, anti-roll
bars; `world.physics.add(v)` makes it once its body is simulated, `remove(v)` leaves the body
wheelless.

- **Wheels** are meshes, children of the body, placed at their centre as they rest on flat ground,
  axle along the body's x; radius and width come from their bounds, and each step turns, steers and
  lifts them on the suspension, drawn at the bodies' time as the body is.
- **Body.** The centre of mass is lowered to the shape's bottom, midway between the wheels, and
  restored when the vehicle leaves. While a vehicle, its running gear is solid: a box over the
  wheels' footprint, from the body's bottom to their lowest point raised by the suspension travel,
  joins its shape, so no body slips under it among the wheels (the module only casts them); mass and
  inertia stay the shape's. The body faces −z; the forward wheels steer.
- **Kinds.** A car: three wheels or more, one differential per driven axle
  (`drive: 'front' | 'rear' | 'all'`), handbrake on the rear. A motorcycle: two, rear-driven,
  leaning into turns. A tracked vehicle: two or more a side, each track driven by its rearmost
  wheel, steered by slowing one track, pivoting on the spot at a standstill.
- **Driving.** A vehicle is a `VehicleDriver`: `world.controls.vehicle = v` drives it with the keys
  ([Camera controllers](SDK.md#camera-controllers)), `v.drive(input)` from code. The brake stops it,
  then backs it up; the throttle first stops one rolling back. Parked — not driven since it was
  made or last stood still — it holds its brakes and its engine idles, so it rests on a slope and
  sleeps at once, never awake while its engine spins down. `v.speed` (m/s forward), `v.gear` (−1
  reverse, 0 neutral) and `v.rpm` read the last step.
- **Specs.** Each kind starts from its declared spec (`VEHICLE_SPECS`,
  `packages/sdk-core/src/physics/vehicleSpec.ts`), each number an option: torque per body kilogram
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
vertex on the module's soft bodies.

- **Shape.** A cloth is its triangles; a rope its vertices in order, each joined to the next; a
  volume its closed, outward triangles held up by the gas inside (`pressure`, Pa above the air's at
  rest, rising when squeezed). Vertices at one position are one (a sphere's seam never tears).
  `pins` are vertex indices held in place.
- **Mass**, spread by the area (a rope: the length) each vertex holds; by default a medium woven
  cotton (`SOFT_AREAL_DENSITY`, 0.2 kg/m²) or a 10 mm polyamide rope (`SOFT_LINEAR_DENSITY`,
  0.065 kg/m).
- **Stiffness.** `stretch` and `bend` are compliances, the inverse of stiffness, for a pulled edge
  and a bent fold (the module's defaults: 0 never stretches, `Infinity` folds freely). A pinned
  cloth with `stretch` 0 keeps each free vertex within its rest distance of the nearest pin (the
  module's long range attachments), so a large one never stretches without end; one given stretch
  keeps its give.
- **Pressure.** A volume's default rests its weight on a quarter of its mean cross-section
  (`SOFT_FOOTPRINT`, declared), or the most its skin holds if less. A pressure past what the skin
  holds within a tenth of its rest volume throws `RangeError`: edges give by their `stretch` and by
  the solver's own compliance (a substep of the page's step squared over a vertex's mass), so a
  light, finely cut skin holds less, and a finer step more. A compiled model's volume is reckoned
  at the engine's step (`PHYSICS_STEP`): it is cooked before any page steps it.
- **Options.** `friction`, `restitution`, `gravityScale` and `damping: { linear }` act per vertex as
  on a rigid body; `shape`, `sensor`, `ccd`, `decorative` and angular damping throw `RangeError`
  (vertices do not turn). No velocity, impulse, joint or vehicle.
- **Damping.** A soft body that declares none loses a hundredth of its speed each step of 60 Hz
  (`SOFT_DAMPING`, `−ln(0.99)·60` = 0.603 per second), whatever its type, mass or size: a swing
  settles within seconds, and it falls at most at `g / 0.603`, 16.3 m/s. A declared value wins, 0
  included; a saved scene leaves the default out.
- **Thickness.** Its vertices keep 1 cm from what they collide with (the module's vertex radius): a
  cloth laid on a surface rests 1 cm above it.
- **Bends.** No bend is stiffer than the solver resolves: its compliance is at least a fifth of the
  one its four vertices' masses give over a substep (`h²·Σ wᵢ|∇ᵢθ|²`), so it corrects at most five
  sixths of the angle it is off per substep; a stiffer one would overshoot and fold its triangles
  through each other. A softer bend is kept as declared. The floor is applied when the body is made,
  over a substep of the page's step (a finer step resolves stiffer bends), cooked bodies included;
  the cooked bytes are unchanged.
- **Speed.** The module holds each vertex under the faster of two speeds: the fall from a hundred
  times the body's size (the diagonal of its rest bounds) under its pull, 59 m/s for a 1.8 m flag,
  and its fall through its own damping, `pull / damping` (500 m/s, the module's own bound, with
  none). The pull is the gravity times its scale, never less than 9.81 m/s², read again whenever
  either changes: neither a swing nor a body falling whole is ever held back.
- **Place.** A direct child of the scene. Moved by the page, it is carried with its vertices, pins
  included, its shape and motion kept and no motion induced by the move; moved more than 3 m at
  once, it starts again at rest in its rest shape at its new place. A slow frame changes nothing:
  the worker steps a fixed 1/60 s, four steps at most a frame. Placed at another scale than it was
  made at, it is refused (`PHYSICS_FAILED`) and leaves the simulation until back at that scale (the
  module scales no soft body once made), as a compiled model's cooked one does; hidden, its vertices
  are not sent.
- **Support.** A static body that the cloth near a pin starts inside (the rest midpoint of an edge
  from a pin lies 1 mm deep in its shape) is passed through by that soft body, which it would
  otherwise push out against its own pins at every step. It is judged once per pair, again when
  either is moved, and forgotten when the body leaves. Pins on a surface keep colliding with it: a
  flag pinned on its pole's surface still wraps round the pole (the module's filter is per body, not
  per vertex).
- **Divergence.** A body, soft or rigid, whose vertices or pose go non-finite sends none: it keeps
  its last finite one on screen and leaves the simulation with `PHYSICS_DIVERGED` (the mesh named).
  A soft body has also diverged when its vertices go apart, the spread of their velocities, at
  twice the speed of a fall from a hundred times its size for half a second, or when its bounds pass
  three times their rest diagonal while one of its edges is pulled past five times its rest length
  (a rope coiled at rest hangs out to its length with whole edges: no divergence). It stays in the
  simulation: brought back at rest to the state it kept a quarter to half a second before (its rest
  shape, at its pins or around its centre of mass, when it kept none), then calmed for 2 s, damped
  so that it falls no faster than a quarter of its mean edge per step. The page counts it in
  `world.physics.stats.softRecoveries` and hears a non-fatal `PHYSICS_DIVERGED` naming it, at most
  once a second. The module finds a soft body's collision planes once per step for its five
  substeps, so a fine cloth draped over a sharp edge or corner can still throw itself apart and be
  brought back this way.
- **Collisions.** Rigid bodies and the character collide with its vertices: the character is turned
  aside or stopped, never pushing it; a rigid body much heavier than the skin can push between its
  vertices; soft bodies pass through each other (the module collides them with rigid bodies only).
  `on('contact' | 'enter' | 'leave')` works on either side, from the module's soft-body contact
  listener: the point is the mean of the touching vertices, the impulse estimated from their mean
  velocity and mass, a pair stays entered while both rest; a sensor reports without stopping it.
- **Drawing.** `mesh.physics.vertices` reads the vertices as they are drawn, `x, y, z` per geometry
  vertex in the geometry's frame, at the bodies' time: between the places the two steps that
  bracket it left them, as a body is drawn; the geometry is dynamic
  ([Geometry rewritten every frame](SDK.md#geometry-rewritten-every-frame)). A compiled model's
  cooked soft body draws through the GPU deformation source (`deformation/softSource.ts`,
  `physics/cookedSoft.ts`): its cooked render positions and indices are attached to the model's
  nodes, each step's vertices are copied in with their normals, and the deformation pass moves the
  drawn pages ([GPU deformation](ENGINE.md#gpu-deformation)).

## Stillness, distance and view

A sleeping body sends nothing; once all sleep, the worker takes no step, the page sends it nothing
and no frame is drawn.
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
| `threads` | 8 | the module's thread pool, the worker's included, on a cross-origin isolated page (one elsewhere), at most the logical cores minus the page's own; the worker times its steps and uses fewer threads while more only contend; the module computes the same step on any count |
| `softVertices` | 16384 (four cloths of 64 × 64) | every soft body's vertices at once |

| Case | Refusal |
| --- | --- |
| a key that is no budget | `PHYSICS_BUDGET` from `createWorld`, a `TypeError` when added to `world.budget.physics` |
| a request past one, or a step finding more pairs or contacts than budgeted | `PHYSICS_BUDGET` on `world.physics.error` |
| a soft body past `softVertices` | `PHYSICS_BUDGET` naming `softVertices` |
| an `enter` past the events budget | counted in `stats.droppedEvents`; its `leave` is never sent |

Every soft vertex is solved each step, so the step grows linearly with them; a page needing fewer
lowers `softVertices`.

**Cost.** The `physics` CPU stage is the page's share (`stats.mainMs`); the worker's step is
`stats.stepMs` (mean of the last tick's steps) and `stats.stepMaxMs` (its slowest), on its own
clock: never added together.

## Compiled models

A model loaded with `scene.load()` collides with its own triangles once physics is on: the compiler
cooked them (`physics.json`, [FORMAT.md](FORMAT.md)), and tiles stream in from the module's binary
state around every moving body and the eye up to the simulation range, nearest first, within half of
`budget.physics.memoryBytes`, leaving as they move away (a tile stays until half as far again as it
came in). No scene is refused for its size: a tile that does not fit waits, the farthest leaving for
it. Another format or another engine build's cook is refused (`PHYSICS_FORMAT`); a model compiled
without a physics cook collides nowhere. A tile or a soft body's settings the server refuses is
`RESOURCE_HTTP_ERROR` on `world.physics.error` ([Files over HTTP](SDK.md#files-over-http)); a model
leaving the scene drops its pending reads, no error.

Tiles grip and bounce as the source's `KHR_physics_rigid_bodies` collider declares, else with
`DEFAULT_MATTER`. Every drawn node is static ground but one declaring a `motion`: its body is
restored as cooked (implicit shape, or fetched hull), counted in `budget.physics`, with its motion's
mass, centre of mass and inertia, else the cooked ones (cooked inertia moved to a declared centre);
its tiles, and those of a node its collider is made from, leave. A kinematic one follows its model,
pushing what it meets (under a dynamic one, as that body carries its node); a dynamic one simulates,
its node and what hangs under it drawn where the simulation puts them, that subtree's tiles leaving
and ground streaming in around it; moved by the page with its model or node, it is put where the
node is then drawn. In a partitioned model, whose cache numbers nodes otherwise, it is held
kinematic and asleep where drawn. A shape the module cannot make at the body's scale is
`PHYSICS_FAILED` naming its node, which stays static ground; a body refused at a rescale is made
again at another scale.

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
