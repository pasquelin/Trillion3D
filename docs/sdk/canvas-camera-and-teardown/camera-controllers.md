# Camera controllers

A controller reads the canvas's pointer, wheel and key events and writes the camera's pose; a world
asks for one at creation and drives it through `world.controls`:

```js
const world = createWorld('viewer', { controls: 'orbit' }) // at creation
world.controls.kind = 'fly' // switch live
world.controls.enabled = false // pause input
world.controls.target.set(0, 1, 0) // orbit pivot
```

They live on the world, whose canvas they read, and follow `world.camera` when it is replaced;
setting `kind` releases the current controller and builds the next. `firstPerson` is the
character's head without a body.

| `world.controls.kind` | Motion                                         | Gestures                                                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `'orbit'`             | orbit around `target`, world up kept           | drag turns, secondary drag or two fingers pan, wheel and pinch zoom |
| `'fly'`               | six degrees of freedom                         | `W`/`S`, `A`/`D`, `R`/`F`, arrows, `Q`/`E` roll, drag to look       |
| `'firstPerson'`       | pointer-locked walk, horizon level             | pointer turns the head, `W`/`S`/`A`/`D`, `Space`/`Shift`            |
| `'character'`         | a body that walks, runs, jumps and falls       | pointer turns the head, `W`/`S`/`A`/`D`, `Space` jumps              |
| `'vehicle'`           | none: drives `world.controls.vehicle`          | `W` throttle, `S` brake, `A`/`D` steer, `Space` handbrake           |
| `'trackball'`         | free spin about the screen axes, roll included | drag spins, secondary drag pans, wheel zooms                        |
| `'panZoom'`           | planar view, no rotation                       | drag slides, wheel and pinch zoom, arrow keys pan                   |
| `'none'` (default)    | camera posed by the host                       | none                                                                |

All publish `object.position`, `addEventListener('change')`, `removeEventListener` and `dispose()`;
the three with a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`, `enablePan` and
`update()`, which clamps a pose the host wrote. `change` fires only when the pose moved.
`enableZoom` and `enablePan` (`true`) are also settings of `world.controls`, kept across `kind`
like its limits and speeds: readable under every kind, read only by a controller with a pivot, so
one turned off under `'fly'` is off in the `'orbit'` that follows.

**The character's body.** `'character'` moves an upright capsule with an adult's values
(`HUMAN_BODY`, the engine's own character: a 0.34 m radius and 1.76 m capsule, a 6 m/s walk, a 4.2 m/s jump, 44.765° slopes, 0.45 m steps, 100 kg, a 250 N push),
each a setting of `world.controls`. Its body is the physics' virtual character in its worker
([PHYSICS.md](../../PHYSICS.md)), so the world needs `physics: true`: it climbs steps and slopes, rides
a moving platform, pushes dynamic bodies with at most `pushStrength` newtons and is pushed back,
and the level is whatever carries `mesh.physics = 'static'`. The feet are drawn at the bodies' time.
Until the physics runs the character stands where it was put and hears no key.

The body reads one drive (`characterDrive.ts`), the engine's movement model: on a floor the velocity
turns toward the wish by `groundFriction` (8 per second), gathers `maxAcceleration` up to `walkSpeed`
(6 m/s) and, with no key, is braked by the friction and `brakingDecelerationWalking` (20.48 m/s²); in
the air the sideways velocity is kept (`fallingLateralFriction` 0, `brakingDecelerationFalling` 0), the
keys pushing with `airControl` (0.05, doubled under `airControlBoostVelocityThreshold` 0.25 m/s) of the
force, and the fall is held to `terminalVelocity` (40 m/s). A press jumps once, from a floor, before the next landing (`jumpMaxCount` 1, `jumpMaxHoldTime` 0): a press in the air, or one the body is not allowed, is lost, and a body that walked off an edge has no jump. The
physics takes at most four steps a frame (`MAX_CATCH_UP_STEPS`): a slower page shows slow motion,
never a jump.

**The character's modes.** The body walks, falls, swims where `world.physics.water` carries it and
flies while `flying` is set (`controls.mode`). `canCrouch` (false by default) lets C crouch it to
`crouchedHeight` (0.8 m) at `crouchedSpeed`; `canSwim` (true), `swimSpeed` (3 m/s), `flySpeed` (6 m/s),
`buoyancy` (1), `fluidFriction` (0.3) and `maxAcceleration` (20.48 m/s²) shape a body in a fluid, which
goes where the head looks, Space rising and C sinking ([PHYSICS.md](../../PHYSICS.md#movement-modes)).

```ts
world.controls = 'character'
world.controls.canCrouch = true
world.controls.flying = true // the body flies; false lets it fall
```

**The character's gravity.** The body is pulled by the world's gravity, `world.physics.gravity`,
times `world.controls.gravityScale` (1 by default; 0 floats the body, and no sole then pushes on the
floor): the rise after a jump, the apex of a given `jumpSpeed`, and the fall follow
the world, live, so a Moon world lifts the body higher and longer, and lets it fall as slowly. The
rise and the fall are under the one gravity, and only its vertical component counts: a body stands
upright on its world's up, so a gravity vector with a sideways part pulls it down by its `y` alone.

```js
world.physics.gravity = 'moon' // the body rises and falls under 1.62 m/s²
world.controls.gravityScale = 0.5 // and feels half of it
```

**Vehicles.** `'vehicle'` maps the keys to a `VehicleInput` (`throttle`, `brake`, `steer`,
`handbrake`) and hands it to `world.controls.vehicle.drive(input)` on each change. Any object with
`drive` can be driven, the physics' vehicles first (`vehicle.car`,
[PHYSICS.md](../../PHYSICS.md#vehicles)). `kind = 'vehicle'` while `vehicle` is `null` throws
`NO_VEHICLE`. The camera does not follow: the page moves it in `world.beforeFrame` ([Loop](../loop.md#loop)),
never in `onFrame`, a frame late.
