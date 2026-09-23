import type JoltModule from 'jolt-physics/wasm';
import { clamp } from '../math3.ts';
import type { Inputs } from '../protocol.ts';
import { LAYER, type Physics } from './physics.ts';

/**
 * The walker: a Jolt `CharacterVirtual` capsule that walks, runs on a stamina reserve, crouches,
 * jumps, climbs stairs and slopes and sticks to the ground going down them. Speeds are a
 * person's: 1.4 m/s walking, 6 m/s running, 0.9 m/s crouched.
 */
export const FOOT = {
  walk: 1.4,
  run: 6,
  crouch: 0.9,
  /** Take-off speed of a jump, m/s: about 0.8 m of rise. */
  jump: 4,
  radius: 0.3,
  height: 1.8,
  crouchHeight: 1.2,
  /** Eye height standing and crouched, metres above the feet. */
  eye: 1.7,
  crouchEye: 1.1,
  maxSlope: (50 * Math.PI) / 180,
  stepUp: 0.45,
  stickDown: 0.5,
  /** Horizontal acceleration on the ground and in the air, m/s². */
  grip: 20,
  air: 3,
  /** Seconds of running a full reserve allows, and seconds to refill it. */
  staminaSeconds: 12,
  refillSeconds: 8,
} as const;

export type Walker = {
  character: JoltModule.CharacterVirtual;
  standing: JoltModule.Shape;
  crouching: JoltModule.Shape;
  update: JoltModule.ExtendedUpdateSettings;
  crouched: boolean;
  running: boolean;
  stamina: number;
  exhausted: boolean;
  jumps: number;
  velocity: JoltModule.Vec3;
};

function capsule(J: Physics['J'], height: number) {
  const half = (height - 2 * FOOT.radius) / 2;
  const offset = new J.Vec3(0, height / 2, 0);
  const inner = new J.CapsuleShapeSettings(half, FOOT.radius);
  const shape = new J.RotatedTranslatedShapeSettings(offset, J.Quat.prototype.sIdentity(), inner)
    .Create()
    .Get();
  J.destroy(offset);
  return shape;
}

/** A walker standing at physics-local (x, y, z). */
export function walker(physics: Physics, x: number, y: number, z: number, jumps = 0): Walker {
  const { J, system } = physics;
  const settings = new J.CharacterVirtualSettings();
  const standing = capsule(J, FOOT.height);
  settings.mShape = standing;
  settings.mMaxSlopeAngle = FOOT.maxSlope;
  settings.mSupportingVolume = new J.Plane(J.Vec3.prototype.sAxisY(), -FOOT.radius);
  settings.mEnhancedInternalEdgeRemoval = true;
  settings.mInnerBodyLayer = LAYER.moving;
  const at = new J.RVec3(x, y, z);
  const character = new J.CharacterVirtual(settings, at, J.Quat.prototype.sIdentity(), system);
  J.destroy(at);
  const update = new J.ExtendedUpdateSettings();
  update.mStickToFloorStepDown.Set(0, -FOOT.stickDown, 0);
  update.mWalkStairsStepUp.Set(0, FOOT.stepUp, 0);
  return {
    character,
    standing,
    crouching: capsule(J, FOOT.crouchHeight),
    update,
    crouched: false,
    running: false,
    stamina: 1,
    exhausted: false,
    jumps,
    velocity: new J.Vec3(0, 0, 0),
  };
}

function reshape(physics: Physics, walker: Walker, shape: JoltModule.Shape) {
  const { filters: f } = physics;
  return walker.character.SetShape(
    shape,
    1.5 * walker.character.GetCharacterPadding(),
    f.broad,
    f.object,
    f.body,
    f.shape,
    physics.jolt.GetTempAllocator(),
  );
}

/** The horizontal speed the walker aims for, and whether it is running. */
function pace(walker: Walker, inputs: Inputs, dt: number) {
  const moving = Math.hypot(inputs.forward, inputs.right) > 0.1;
  walker.running =
    inputs.run && moving && inputs.forward > 0 && !walker.crouched && !walker.exhausted;
  walker.stamina = clamp(
    walker.stamina + (walker.running ? -dt / FOOT.staminaSeconds : dt / FOOT.refillSeconds),
    0,
    1,
  );
  if (walker.stamina === 0) walker.exhausted = true;
  if (walker.exhausted && walker.stamina > 0.3) walker.exhausted = false;
  return walker.crouched ? FOOT.crouch : walker.running ? FOOT.run : FOOT.walk;
}

/** One step of the walker, reading the held keys and the look heading from `inputs`. */
export function stepWalker(physics: Physics, walker: Walker, inputs: Inputs, dt: number) {
  const { J, filters: f } = physics;
  const ch = walker.character;
  if (inputs.crouch !== walker.crouched)
    if (reshape(physics, walker, inputs.crouch ? walker.crouching : walker.standing))
      walker.crouched = inputs.crouch;
  const speed = pace(walker, inputs, dt);
  const length = Math.max(1, Math.hypot(inputs.forward, inputs.right));
  const [f1, r1] = [inputs.forward / length, inputs.right / length];
  const [s, c] = [Math.sin(inputs.lookYaw), Math.cos(inputs.lookYaw)];
  const wishX = (-s * f1 + c * r1) * speed;
  const wishZ = (-c * f1 - s * r1) * speed;
  const current = ch.GetLinearVelocity();
  let [vx, vy, vz] = [current.GetX(), current.GetY(), current.GetZ()];
  const grounded = ch.GetGroundState() === J.EGroundState_OnGround;
  const reach = (grounded ? FOOT.grip : FOOT.air) * dt;
  const [dx, dz] = [wishX - vx, wishZ - vz];
  const gap = Math.hypot(dx, dz);
  const share = gap > reach ? reach / gap : 1;
  vx += dx * share;
  vz += dz * share;
  if (grounded) {
    const ground = ch.GetGroundVelocity();
    if (vy - ground.GetY() < 0.1) vy = ground.GetY();
    if (inputs.jump !== walker.jumps && !walker.crouched) vy += FOOT.jump;
  }
  walker.jumps = inputs.jump;
  vy += physics.gravity.GetY() * dt;
  walker.velocity.Set(vx, vy, vz);
  // A slope too steep to climb takes no velocity towards it.
  const allowed = grounded ? ch.CancelVelocityTowardsSteepSlopes(walker.velocity) : walker.velocity;
  walker.velocity.Set(allowed.GetX(), allowed.GetY(), allowed.GetZ());
  ch.SetLinearVelocity(walker.velocity);
  ch.ExtendedUpdate(
    dt,
    physics.gravity,
    walker.update,
    f.broad,
    f.object,
    f.body,
    f.shape,
    physics.jolt.GetTempAllocator(),
  );
}

/** Physics-local feet position and whether the walker stands on something. */
export function walkerPose(physics: Physics, walker: Walker) {
  const p = walker.character.GetPosition();
  const grounded = walker.character.GetGroundState() === physics.J.EGroundState_OnGround;
  return { x: p.GetX(), y: p.GetY(), z: p.GetZ(), grounded };
}

export function placeWalker(physics: Physics, walker: Walker, x: number, y: number, z: number) {
  const at = new physics.J.RVec3(x, y, z);
  walker.character.SetPosition(at);
  physics.J.destroy(at);
  walker.velocity.Set(0, 0, 0);
  walker.character.SetLinearVelocity(walker.velocity);
}
