# Camera controllers

`world.controls` writes the camera pose from canvas input:

```js
const world = createWorld('viewer', { controls: 'orbit' }) // at creation
world.controls.kind = 'fly' // switch live
world.controls.enabled = false // pause input
world.controls.target.set(0, 1, 0) // orbit pivot
```

Controllers follow `world.camera` when replaced; setting `kind` releases the current one and builds
the next. `firstPerson` is the character's head without a body.

| `world.controls.kind` | Motion | Gestures |
| - | - | - |
| `'orbit'` | around `target`, up kept | drag turns, secondary drag or two fingers pan, wheel/pinch zoom |
| `'fly'` | 6 degrees of freedom | `W`/`S`, `A`/`D`, `R`/`F`, arrows, `Q`/`E` roll, drag looks |
| `'firstPerson'` | pointer-locked walk | pointer turns, `W`/`S`/`A`/`D`, `Space`/`Shift` |
| `'character'` | body that walks, jumps, falls | pointer turns, `W`/`S`/`A`/`D`, `Space` jumps |
| `'vehicle'` | drives `world.controls.vehicle` | `W` throttle, `S` brake, `A`/`D` steer, `Space` handbrake |
| `'trackball'` | free spin, roll | drag spins, secondary drag pans, wheel zooms |
| `'panZoom'` | planar | drag slides, wheel/pinch zoom, arrows pan |
| `'none'` (default) | host poses camera | none |

All publish `object.position`, `addEventListener('change')` (fires when the pose moved),
`removeEventListener` and `dispose()`; the three with a pivot add `target`, `minDistance`,
`maxDistance`, `enableZoom`, `enablePan` (`true`; kept across `kind`) and `update()` (clamps a pose
the host wrote).

## The character's body

`'character'`: upright capsule, `HUMAN_BODY` values (0.34 m radius, 1.76 m, 6 m/s walk, 4.2 m/s
jump, 44.765° slopes, 0.45 m steps, 100 kg, 250 N push), each a `world.controls` setting. The
physics' virtual character ([PHYSICS.md](../../PHYSICS.md)): needs `physics: true`; pushes bodies
with at most `pushStrength` N; level = `mesh.physics = 'static'`. Until physics runs it hears no
key.

Drive (`characterDrive.ts`):

- Floor: `groundFriction` (8/s), `maxAcceleration` up to `walkSpeed` (6 m/s); no key: braked by
  friction and `brakingDecelerationWalking` (20.48 m/s²).
- Air: `fallingLateralFriction` 0, `brakingDecelerationFalling` 0; `airControl` 0.05 (doubled under
  `airControlBoostVelocityThreshold` 0.25 m/s); `terminalVelocity` 40 m/s.
- One jump from a floor per landing (`jumpMaxCount` 1, `jumpMaxHoldTime` 0); none in the air or
  after walking off an edge.
- At most four physics steps a frame (`MAX_CATCH_UP_STEPS`).

## The character's modes

Walks, falls, swims where `world.physics.water` carries it, flies while `flying` is set
(`controls.mode`). `canCrouch` (false): C crouches to `crouchedHeight` (0.8 m) at `crouchedSpeed`;
`canSwim` (true), `swimSpeed` (3 m/s), `flySpeed` (6 m/s), `buoyancy` (1), `fluidFriction` (0.3),
`maxAcceleration` (20.48 m/s²); in a fluid it goes where the head looks, Space up, C down
([PHYSICS.md](../../PHYSICS.md#movement-modes)).

```ts
world.controls = 'character'
world.controls.canCrouch = true
world.controls.flying = true // the body flies; false lets it fall
```

## The character's gravity

Gravity is `world.physics.gravity` times `world.controls.gravityScale` (1; 0 floats the body),
live: a jump's rise (apex of a given `jumpSpeed`) and the fall follow it. Only the vertical
component counts: a body stands upright on its world's up, so a sideways part pulls it down by `y`
alone.

```js
world.physics.gravity = 'moon' // the body rises and falls under 1.62 m/s²
world.controls.gravityScale = 0.5 // and feels half of it
```

## Vehicles

`'vehicle'` maps keys to a `VehicleInput` (`throttle`, `brake`, `steer`, `handbrake`) for
`world.controls.vehicle.drive(input)`; any object with `drive` works (`vehicle.car`,
[PHYSICS.md](../../PHYSICS.md#vehicles)). `kind = 'vehicle'` while `vehicle` is `null` throws
`NO_VEHICLE`. The camera does not follow: move it in `world.beforeFrame`
([Loop](../loop.md#loop)), never `onFrame`.
