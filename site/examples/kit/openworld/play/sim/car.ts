import type JoltModule from 'jolt-physics/wasm';
import type { Inputs } from '../protocol.ts';
import type { Wheel } from '../types.ts';
import { LAYER, type Physics } from './physics.ts';

/**
 * The player's car: a Jolt `WheeledVehicleConstraint` on a box body, rear-wheel drive, the front
 * pair steering. The nose points to local -Z. Off the asphalt the engine gives less torque and
 * the ground drags, so a road is the fast way across the map.
 */
const CAR = {
  mass: 1400,
  torque: 520,
  offRoadTorque: 320,
  /** Extra drag off the road, as a deceleration per m/s of speed: grass and gravel hold it back. */
  offRoadDrag: 0.08,
  halfExtents: [0.9, 0.45, 2.2] as const,
  maxSteer: 0.6,
};

export type Car = {
  body: JoltModule.Body;
  constraint: JoltModule.VehicleConstraint;
  controller: JoltModule.WheeledVehicleController;
  listener: JoltModule.VehicleConstraintStepListener;
  wheels: readonly Wheel[];
  temp: JoltModule.Vec3;
};

/** A car at physics-local `at`, turned `heading` radians about +Y, on `wheels` (front pair first). */
export function car(
  physics: Physics,
  wheels: readonly Wheel[],
  at: readonly number[],
  heading: number,
  mass = CAR.mass,
): Car {
  const { J, bodies, system } = physics;
  const [hx, hy, hz] = CAR.halfExtents;
  const half = new J.Vec3(hx, hy, hz);
  const lower = new J.Vec3(0, -hy * 0.8, 0);
  const shape = new J.OffsetCenterOfMassShapeSettings(lower, new J.BoxShapeSettings(half))
    .Create()
    .Get();
  const where = new J.RVec3(at[0], at[1], at[2]);
  const up = new J.Vec3(0, 1, 0);
  const turn = J.Quat.prototype.sRotation(up, heading);
  const creation = new J.BodyCreationSettings(
    shape,
    where,
    turn,
    J.EMotionType_Dynamic,
    LAYER.moving,
  );
  creation.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
  creation.mMassPropertiesOverride.mMass = mass;
  const body = bodies.CreateBody(creation);
  bodies.AddBody(body.GetID(), J.EActivation_Activate);
  const settings = new J.VehicleConstraintSettings();
  settings.mUp.Set(0, 1, 0);
  settings.mForward.Set(0, 0, -1);
  settings.mMaxPitchRollAngle = Math.PI / 3;
  settings.mWheels.clear();
  for (const wheel of wheels) {
    const made = new J.WheelSettingsWV();
    made.mPosition.Set(wheel.position[0], wheel.position[1], wheel.position[2]);
    made.mWheelForward.Set(0, 0, -1);
    made.mRadius = wheel.radius;
    made.mWidth = wheel.width;
    made.mMaxSteerAngle = wheel.steer ? CAR.maxSteer : 0;
    made.mMaxHandBrakeTorque = wheel.steer ? 0 : 4000;
    made.mSuspensionMinLength = 0.2;
    made.mSuspensionMaxLength = 0.5;
    settings.mWheels.push_back(made);
  }
  const drive = new J.WheeledVehicleControllerSettings();
  drive.mEngine.mMaxTorque = CAR.torque;
  drive.mDifferentials.clear();
  const rear = new J.VehicleDifferentialSettings();
  const driven = wheels
    .map((wheel, index) => [wheel, index] as const)
    .filter(([wheel]) => !wheel.steer);
  rear.mLeftWheel = driven.find(([wheel]) => wheel.position[0] < 0)?.[1] ?? -1;
  rear.mRightWheel = driven.find(([wheel]) => wheel.position[0] > 0)?.[1] ?? -1;
  drive.mDifferentials.push_back(rear);
  settings.mController = drive;
  const constraint = new J.VehicleConstraint(body, settings);
  constraint.SetVehicleCollisionTester(
    new J.VehicleCollisionTesterCastCylinder(LAYER.moving, 0.05),
  );
  system.AddConstraint(constraint);
  const listener = new J.VehicleConstraintStepListener(constraint);
  system.AddStepListener(listener);
  const controller = J.castObject(constraint.GetController(), J.WheeledVehicleController);
  for (const made of [half, lower, where, up, creation]) J.destroy(made);
  return { body, constraint, controller, listener, wheels, temp: new J.Vec3(0, 0, 0) };
}

/** Driver input for one step; `asphalt` says whether the car rolls on a paved road. */
export function drive(physics: Physics, vehicle: Car, inputs: Inputs | null, asphalt: boolean) {
  const { J, bodies } = physics;
  const id = vehicle.body.GetID();
  const velocity = bodies.GetLinearVelocity(id);
  const [vx, vy, vz] = [velocity.GetX(), velocity.GetY(), velocity.GetZ()];
  const forward = vehicle.body.GetRotation().RotateAxisZ();
  const along = -(vx * forward.GetX() + vy * forward.GetY() + vz * forward.GetZ());
  let throttle = inputs?.forward ?? 0;
  let brake = 0;
  // Pressing against the motion brakes first; once stopped, the same key reverses.
  if (throttle * along < -0.5) {
    brake = Math.abs(throttle);
    throttle = 0;
  }
  const handBrake = inputs?.brake || !inputs ? 1 : 0;
  vehicle.controller.SetDriverInput(throttle, inputs?.right ?? 0, brake, handBrake);
  vehicle.controller.GetEngine().mMaxTorque = asphalt ? CAR.torque : CAR.offRoadTorque;
  if (inputs || Math.hypot(vx, vz) > 0.1) bodies.ActivateBody(id);
  if (!asphalt) {
    const pull = -CAR.offRoadDrag * CAR.mass;
    vehicle.temp.Set(vx * pull, 0, vz * pull);
    bodies.AddForce(id, vehicle.temp, J.EActivation_DontActivate);
  }
  return along;
}

/** Writes the body pose, then each wheel's local pose (axle along the wheel mesh's +Y). */
export function carPose(physics: Physics, vehicle: Car, out: Float32Array, at: number) {
  const { J } = physics;
  const p = vehicle.body.GetPosition();
  const q = vehicle.body.GetRotation();
  out.set([p.GetX(), p.GetY(), p.GetZ(), q.GetX(), q.GetY(), q.GetZ(), q.GetW()], at);
  const right = new J.Vec3(0, 1, 0);
  const up = new J.Vec3(1, 0, 0);
  vehicle.wheels.forEach((_, index) => {
    const local = vehicle.constraint.GetWheelLocalTransform(index, right, up);
    const t = local.GetTranslation();
    const r = local.GetQuaternion();
    out.set(
      [t.GetX(), t.GetY(), t.GetZ(), r.GetX(), r.GetY(), r.GetZ(), r.GetW()],
      at + 7 + index * 7,
    );
  });
  J.destroy(right);
  J.destroy(up);
}

export function removeCar(physics: Physics, vehicle: Car) {
  const { system, bodies } = physics;
  system.RemoveStepListener(vehicle.listener);
  system.RemoveConstraint(vehicle.constraint);
  bodies.RemoveBody(vehicle.body.GetID());
  bodies.DestroyBody(vehicle.body.GetID());
}
