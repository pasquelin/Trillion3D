import test from 'node:test'
import assert from 'node:assert/strict'
import { createDrive, driveTick, pressJump, resetJump } from './characterDrive.ts'
import { HUMAN_BODY, type CharacterSettings } from './characterSettings.ts'
import { GRAVITY_PRESETS } from '../physics/options.ts'

const STILL = { wishX: 0, wishZ: 0 },
  EAST = { wishX: 1, wishZ: 0 },
  g = GRAVITY_PRESETS.earth

/** Lives ticks of `h` seconds under `input` for `seconds`; returns the distance moved east and up. */
function run(
  drive: ReturnType<typeof createDrive>,
  input: typeof STILL,
  seconds: number,
  h = 1 / 120,
  settings: CharacterSettings = HUMAN_BODY,
) {
  const step = { dx: 0, dy: 0, dz: 0, jumped: false },
    moved = { x: 0, y: 0 }
  for (let t = 0; t < seconds - 1e-9; t += h)
    if (driveTick(drive, settings, input, h, {}, step)) {
      moved.x += step.dx
      moved.y += step.dy
    }
  return moved
}

/** A drive on its feet, going east at `speed`. */
function jogging(speed: number) {
  const drive = createDrive()
  drive.velocity[0] = speed
  return drive
}

/** A drive in the air, going east at `speed` and up at `rise`. */
function flying(speed: number, rise = 0) {
  const drive = createDrive()
  drive.grounded = false
  drive.velocity[0] = speed
  drive.velocity[1] = rise
  return drive
}

test('on a floor a held key gathers speed to the walk speed and no further', () => {
  const drive = createDrive()
  run(drive, EAST, 1)
  assert.ok(Math.abs(drive.velocity[0] - HUMAN_BODY.walkSpeed) < 1e-9, `${drive.velocity[0]}`)
})

test('with no key friction and the walking deceleration brake to a stop', () => {
  const drive = jogging(HUMAN_BODY.walkSpeed),
    { x } = run(drive, STILL, 1)
  assert.equal(drive.velocity[0], 0)
  // 16 / s of friction and 20.48 m/s² of braking: a jog of 6 m/s is down in about 0.2 s
  assert.ok(x > 0.15 && x < 0.3, `glide ${x} m`)
})

test('without ground friction the walking deceleration alone brakes: v² / (2 a) to a stop', () => {
  const settings = { ...HUMAN_BODY, groundFriction: 0 },
    v = HUMAN_BODY.walkSpeed,
    a = HUMAN_BODY.brakingDecelerationWalking
  const { x } = run(jogging(v), STILL, 2, 1 / 120, settings)
  // the body moves by the velocity at the end of each tick, v h / 2 short of the exact glide
  assert.ok(Math.abs(x - (v * v) / (2 * a)) < v / 120, `${x} m`)
})

test('in the air the sideways speed is kept with no key', () => {
  const drive = flying(6, 0)
  run(drive, STILL, 0.5)
  assert.ok(Math.abs(drive.velocity[0] - 6) < 1e-9)
})

test('in the air a key pushes with airControl of the force, boosted under a quarter of a metre a second', () => {
  const slow = flying(0)
  run(slow, EAST, 0.1)
  // boost 2 × 0.05 = 0.1 of 20.48 m/s², for 0.1 s
  assert.ok(Math.abs(slow.velocity[0] - 0.2048) < 1e-6, `${slow.velocity[0]}`)
  const quick = flying(1)
  run(quick, EAST, 0.1)
  assert.ok(Math.abs(quick.velocity[0] - 1 - 0.1024) < 1e-6, `${quick.velocity[0]}`)
  const none = flying(0)
  run(none, EAST, 0.1, 1 / 120, { ...HUMAN_BODY, airControl: 0 })
  assert.equal(none.velocity[0], 0)
})

/** Ticks of `h` seconds from `drive`, `press` ticks the jump key goes down at; the jumps counted, the
 *  height gained. */
function jumping(
  drive: ReturnType<typeof createDrive>,
  seconds: number,
  presses: number[],
  settings: CharacterSettings = HUMAN_BODY,
  h = 1 / 60,
) {
  const step = { dx: 0, dy: 0, dz: 0, jumped: false },
    out = { jumps: 0, y: 0 }
  for (let tick = 0; tick * h < seconds - 1e-9; tick++) {
    if (presses.includes(tick)) pressJump(drive)
    driveTick(drive, settings, STILL, h, { onJump: () => out.jumps++ }, step)
    out.y += step.dy
  }
  return out
}

test('a jump leaves at the jump speed and rises as one gravity says, whatever the tick', () => {
  for (const h of [1 / 240, 1 / 60, 0.09]) {
    const { y } = jumping(createDrive(), 0.45, [0], HUMAN_BODY, h)
    const v = HUMAN_BODY.jumpSpeed,
      expected = v * 0.45 - 0.5 * g * 0.45 ** 2
    assert.ok(Math.abs(y - expected) < 1e-9, `tick ${h}: ${y} m for ${expected} m`)
  }
})

test('a press is read once: late it is lost, in the air it does not jump, a landing gives the jump back', () => {
  // The press of a body that walked off an edge is denied: no first jump from the air.
  const falling = flying(0)
  assert.equal(jumping(falling, 0.1, [0]).jumps, 0)
  // The press in the air after a jump is the second jump: none by default.
  const drive = createDrive()
  assert.equal(jumping(drive, 0.3, [0, 10]).jumps, 1)
  // Landed, the count is given back.
  drive.grounded = true
  resetJump(drive)
  assert.equal(jumping(drive, 0.05, [0]).jumps, 1)
  // Crouched, a body does not jump.
  const crouched = createDrive()
  crouched.crouched = true
  assert.equal(jumping(crouched, 0.05, [0]).jumps, 0)
})

test('jumpMaxCount lets a body jump again in the air, the second leaving at the jump speed', () => {
  const settings = { ...HUMAN_BODY, jumpMaxCount: 2 },
    drive = createDrive()
  assert.equal(jumping(drive, 0.3, [0, 15], settings).jumps, 2)
  assert.ok(drive.velocity[1] > 0 && drive.velocity[1] <= settings.jumpSpeed)
})

test('a jump held keeps its speed for jumpMaxHoldTime, a released one lets gravity take it', () => {
  const settings = { ...HUMAN_BODY, jumpMaxHoldTime: 0.2, applyGravityWhileJumping: false }
  const drive = createDrive()
  jumping(drive, 0.15, [0], settings)
  assert.ok(Math.abs(drive.velocity[1] - settings.jumpSpeed) < 1e-9, `${drive.velocity[1]}`)
  resetJump(drive)
  jumping(drive, 0.1, [], settings)
  assert.ok(drive.velocity[1] < settings.jumpSpeed)
})

test('a fall is held to the terminal velocity', () => {
  const drive = flying(0, -39)
  run(drive, STILL, 1)
  assert.equal(drive.velocity[1], -HUMAN_BODY.terminalVelocity)
})
