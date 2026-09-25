// The world's vehicles: Jolt's own `VehicleConstraint` on a body, driven by its wheeled, motorcycle
// or tracked controller — engine, gearbox, differentials, suspension and anti-roll bars are
// Jolt's, never rewritten. Here only the driver's pedals and wheel become the controller's input,
// and each step's wheels are written back for the page to draw. Word layouts:
// `packages/sdk-core/src/physics/vehicleLayout.ts` (VEHICLE, UNVEHICLE, DRIVE).
#include "binding.h"
#include "words.h"

#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/Vehicle/MotorcycleController.h>
#include <Jolt/Physics/Vehicle/TrackedVehicleController.h>
#include <Jolt/Physics/Vehicle/VehicleCollisionTester.h>
#include <Jolt/Physics/Vehicle/VehicleConstraint.h>
#include <Jolt/Physics/Vehicle/WheeledVehicleController.h>

#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

enum Kind : uint32_t { CAR, MOTORCYCLE, TRACKED };
enum Role : uint32_t { STEERS = 1, DRIVEN = 2, HANDBRAKE = 4, SPROCKET = 8 };
constexpr uint32_t TORQUE_POINTS = 5, MAX_GEARS = 6, WHEEL_WORDS = 6, STATE_WORDS = 5;
/// The engine's objects face −z, up +y: so do its vehicles, in their body's frame.
const Vec3 FORWARD(0, 0, -1), UP(0, 1, 0), RIGHT(1, 0, 0);
/// Brakes are sized on Earth, whatever the world's gravity (vehicleSpec.ts BRAKES), m/s².
constexpr float STANDARD_GRAVITY = 9.80665f;
/// Below this forward speed a vehicle stands still: the brake pedal then backs it up, and a
/// tracked vehicle steered turns on the spot (m/s; Jolt's vehicle samples, 0.1 and 1).
constexpr float STOPPED = 0.1f, PIVOT = 1.0f;
/// A motorcycle's lean controller rights it at Jolt's own sample's natural frequency and damping
/// ratio — 5,000 N·m/rad and 1,000 N·m·s on a body of 32 kg·m² about its roll axis — for any
/// body's roll inertia: rad/s, and a ratio.
constexpr float LEAN_OMEGA = 12.5f, LEAN_DAMPING = 1.25f;
/// A track's grip along and across itself on firm ground, and its share of the vehicle's mass,
/// turning at its sprocket's radius (vehicleSpec.ts TRACKS).
constexpr float TRACK_GRIP = 1.0f, TRACK_SLIDE = 0.5f, TRACK_MASS = 0.05f;

struct Vehicle {
  Ref<VehicleConstraint> constraint;
  /** The page's vehicle id, the body's slot, the kind. */
  uint32_t id = 0, body = 0, kind = 0;
  /** The driver's input (DRIVE), and the wheel as the hand has turned it so far. */
  float throttle = 0, brake = 0, steer = 0, handbrake = 0, steered = 0;
  /** Of full lock per second, and a tracked vehicle's inner track ratio (vehicleSpec.ts). */
  float steerRate = 4, trackTurn = 0.6f;
};

std::vector<Vehicle> vehicles;
/** After a step, the vehicles' state (`VEHICLE_STATE_WORDS`, `WHEEL_STATE_WORDS` per wheel). */
std::vector<uint32_t> state;

/// The index of the wheel on the other side of `i` nearest along the body, among `wanted`, or -1
/// when none shares its axle (within its radius).
int partnerOf(const std::vector<const uint32_t *> &wheels, size_t i, uint32_t wanted) {
  int best = -1;
  float x = f32(wheels[i]), z = f32(wheels[i] + 2), gap = f32(wheels[i] + 3);
  for (size_t j = 0; j < wheels.size(); ++j) {
    float dz = std::abs(f32(wheels[j] + 2) - z);
    bool role = !wanted || (uint32_t(f32(wheels[j] + 5)) & wanted);
    if ((f32(wheels[j]) < 0) != (x < 0) && role && dz < gap) best = int(j), gap = dz;
  }
  return best;
}

/// The engine and gearbox of the spec at `s` (the VEHICLE words after the header), for a body of
/// `mass` kilograms.
void powertrainOf(VehicleEngineSettings &engine, VehicleTransmissionSettings &gearbox, const uint32_t *s, float mass) {
  engine.mMaxTorque = f32(s) * mass;
  // Jolt's own engine is 0.5 kg·m² for 500 N·m; an engine's inertia, and the friction its
  // damping stands for, grow with its size (vehicleSpec.ts ENGINE).
  engine.mInertia = 0.5f * engine.mMaxTorque / 500.0f;
  engine.mMinRPM = f32(s + 1);
  engine.mMaxRPM = f32(s + 2);
  engine.mNormalizedTorque.Clear();
  for (uint32_t p = 0; p < TORQUE_POINTS && f32(s + 3 + 2 * p) >= 0; ++p)
    engine.mNormalizedTorque.AddPoint(f32(s + 3 + 2 * p), f32(s + 4 + 2 * p));
  gearbox.mShiftUpRPM = f32(s + 13);
  gearbox.mShiftDownRPM = f32(s + 14);
  gearbox.mClutchStrength = f32(s + 15);
  gearbox.mGearRatios.clear();
  for (uint32_t g = 0; g < MAX_GEARS && f32(s + 16 + g) > 0; ++g) gearbox.mGearRatios.push_back(f32(s + 16 + g));
  gearbox.mReverseGearRatios = {-f32(s + 22)};
}

/// The settings of a vehicle on `body` from the VEHICLE words at `w`.
VehicleConstraintSettings settingsOf(const uint32_t *w, const Body &body) {
  const uint32_t kind = w[2], count = w[4], *s = w + 5;
  float mass = 1.0f / std::max(body.GetMotionProperties()->GetInverseMass(), 1e-9f);
  float frequency = f32(s + 24), damping = f32(s + 25), travel = f32(s + 26), antiRoll = f32(s + 27);
  float maxSteer = f32(s + 28), grip = f32(s + 30), finalDrive = f32(s + 23);
  float omega = 2 * JPH_PI * frequency, gravity = world().system->GetGravity().Length();
  float share = mass / float(count), lock = grip * share * STANDARD_GRAVITY;
  const MotionProperties &motion = *body.GetMotionProperties();
  const Mat44 inverse = motion.GetLocalSpaceInverseInertia();
  VehicleConstraintSettings settings;
  settings.mUp = UP;
  settings.mForward = FORWARD;
  std::vector<const uint32_t *> wheels;
  std::vector<float> rates;
  for (uint32_t i = 0; i < count; ++i) {
    const uint32_t *p = w + 5 + 33 + i * WHEEL_WORDS;
    wheels.push_back(p);
    float radius = f32(p + 3);
    uint32_t role = uint32_t(f32(p + 5));
    Ref<WheelSettings> wheel;
    if (kind == TRACKED) {
      auto *tv = new WheelSettingsTV;
      tv->mLongitudinalFriction = TRACK_GRIP, tv->mLateralFriction = TRACK_SLIDE;
      wheel = tv;
    }
    else {
      auto *wv = new WheelSettingsWV;
      wv->mMaxSteerAngle = role & STEERS ? maxSteer : 0.0f;
      wv->mMaxBrakeTorque = lock * radius;
      wv->mMaxHandBrakeTorque = role & HANDBRAKE ? 2 * lock * radius : 0.0f;
      wheel = wv;
    }
    // Jolt makes each spring as stiff as its frequency asks of the body's mass as felt at that
    // wheel; under its share of the weight it sags `share g / (felt (2π f)²)`. The suspension
    // hangs from one radius above the wheel at full bump, and the wheel rests where that sag
    // leaves it: the centre the page placed it at.
    Vec3 arm = (vec3(p) - body.GetShape()->GetCenterOfMass()).Cross(-UP);
    float felt = 1.0f / (motion.GetInverseMass() + arm.Dot(inverse.Multiply3x3(arm)));
    rates.push_back(felt * omega * omega);
    float sag = share * gravity / rates.back();
    wheel->mSuspensionMinLength = radius;
    wheel->mSuspensionMaxLength = radius + travel;
    wheel->mPosition = vec3(p) + UP * std::max(radius, radius + travel - sag);
    wheel->mSuspensionSpring = SpringSettings(ESpringMode::FrequencyAndDamping, frequency, damping);
    wheel->mWheelForward = FORWARD;
    wheel->mRadius = radius;
    wheel->mWidth = f32(p + 4);
    settings.mWheels.push_back(wheel);
  }
  if (kind == TRACKED) {
    auto *tracked = new TrackedVehicleControllerSettings;
    powertrainOf(tracked->mEngine, tracked->mTransmission, s, mass);
    for (uint32_t i = 0; i < count; ++i) {
      VehicleTrackSettings &track = tracked->mTracks[f32(wheels[i]) < 0 ? 0 : 1];
      track.mWheels.push_back(i);
      if (uint32_t(f32(wheels[i] + 5)) & SPROCKET) {
        track.mDrivenWheel = i;
        track.mDifferentialRatio = finalDrive;
        track.mMaxBrakeTorque = lock * float(count) / 2 * f32(wheels[i] + 3);
        track.mInertia = TRACK_MASS * mass * Square(f32(wheels[i] + 3));
      }
    }
    settings.mController = tracked;
    return settings;
  }
  auto *wheeled = kind == MOTORCYCLE ? new MotorcycleControllerSettings : new WheeledVehicleControllerSettings;
  if (kind == MOTORCYCLE) {
    auto *bike = static_cast<MotorcycleControllerSettings *>(wheeled);
    float roll = 1.0f / std::max(FORWARD.Dot(inverse.Multiply3x3(FORWARD)), 1e-9f);
    bike->mMaxLeanAngle = f32(s + 32);
    bike->mLeanSpringConstant = roll * LEAN_OMEGA * LEAN_OMEGA;
    bike->mLeanSpringDamping = 2 * LEAN_DAMPING * LEAN_OMEGA * roll;
  }
  powertrainOf(wheeled->mEngine, wheeled->mTransmission, s, mass);
  // One differential per driven axle, left and right; a wheel alone (a motorcycle's) drives by
  // itself. Each axle takes an even share of the engine's torque.
  for (uint32_t i = 0; i < count; ++i) {
    int j = partnerOf(wheels, i, 0);
    if (antiRoll > 0 && f32(wheels[i]) < 0 && j >= 0) {
      VehicleAntiRollBar bar;
      bar.mLeftWheel = int(i), bar.mRightWheel = j, bar.mStiffness = antiRoll * rates[i];
      settings.mAntiRollBars.push_back(bar);
    }
    if (!(uint32_t(f32(wheels[i] + 5)) & DRIVEN)) continue;
    int k = partnerOf(wheels, i, DRIVEN);
    if (k >= 0 && f32(wheels[i]) >= 0) continue;  // the pair is made from its left wheel
    VehicleDifferentialSettings differential;
    differential.mLeftWheel = f32(wheels[i]) < 0 ? int(i) : -1;
    differential.mRightWheel = f32(wheels[i]) < 0 ? k : int(i);
    differential.mDifferentialRatio = finalDrive;
    wheeled->mDifferentials.push_back(differential);
  }
  for (VehicleDifferentialSettings &d : wheeled->mDifferentials) d.mEngineTorqueRatio = 1.0f / float(wheeled->mDifferentials.size());
  settings.mController = wheeled;
  return settings;
}

void remove(Vehicle &vehicle) {
  if (vehicle.constraint) {
    world().system->RemoveStepListener(vehicle.constraint);
    world().system->RemoveConstraint(vehicle.constraint);
  }
  vehicle = Vehicle();
}

void add(const uint32_t *w) {
  uint32_t id = w[1], index = id & INDEX_MASK, engine = w[3], slotIndex = engine & INDEX_MASK;
  if (index >= vehicles.size()) vehicles.resize(index + 1);
  remove(vehicles[index]);
  const std::vector<Slot> &slots = world().slots;
  // A body refused or gone since the page wrote the vehicle: the page takes it out in turn.
  if (w[2] > TRACKED || slotIndex >= slots.size() || !slots[slotIndex].used || slots[slotIndex].engine != engine) return;
  BodyLockWrite lock(world().system->GetBodyLockInterfaceNoLock(), slots[slotIndex].id);
  if (!lock.Succeeded() || !lock.GetBody().IsDynamic()) return;
  Vehicle &vehicle = vehicles[index];
  vehicle.constraint = new VehicleConstraint(lock.GetBody(), settingsOf(w, lock.GetBody()));
  if (w[2] == TRACKED) vehicle.constraint->SetVehicleCollisionTester(new VehicleCollisionTesterRay(MOVING, UP));
  else vehicle.constraint->SetVehicleCollisionTester(new VehicleCollisionTesterCastCylinder(MOVING));
  vehicle.id = id, vehicle.body = slotIndex, vehicle.kind = w[2];
  float steerTime = f32(w + 5 + 29);
  vehicle.steerRate = steerTime > 0 ? 1.0f / steerTime : FLT_MAX;
  vehicle.trackTurn = Clamp(f32(w + 5 + 31), 0.01f, 1.0f);
  world().system->AddConstraint(vehicle.constraint);
  world().system->AddStepListener(vehicle.constraint);
}

/// Hands the driver's input to the controller: the brake pedal backs a vehicle up once it stands
/// still, the accelerator brakes one rolling back first, and a steered tracked vehicle slows its
/// inner track, or turns on the spot at a standstill (Jolt's vehicle samples).
void steer(Vehicle &v, float dt) {
  const Body &body = *v.constraint->GetVehicleBody();
  float speed = (body.GetRotation().Conjugated() * body.GetLinearVelocity()).Dot(FORWARD);
  float turn = dt * v.steerRate;
  v.steered += Clamp(v.steer - v.steered, -turn, turn);
  float forward = v.throttle, brake = v.brake;
  if (brake > 0 && forward == 0 && speed < STOPPED) forward = -brake, brake = 0;
  else if (forward > 0 && speed < -STOPPED) brake = forward, forward = 0;
  VehicleController *controller = v.constraint->GetController();
  if (v.kind == TRACKED) {
    float left = 1, right = 1, amount = std::abs(v.steered);
    float &inner = v.steered > 0 ? right : left;
    if (amount > 0 && forward == 0 && brake == 0 && std::abs(speed) < PIVOT) forward = amount, inner = -1;
    else inner = 1 - amount * (1 - v.trackTurn);
    static_cast<TrackedVehicleController *>(controller)->SetDriverInput(forward, left, right, std::max(brake, v.handbrake));
    return;
  }
  // Leaned, a motorcycle brakes less, or it slides out from under its rider (Jolt's sample).
  if (v.kind == MOTORCYCLE && brake > 0) {
    Vec3 up = body.GetRotation() * UP, ahead = body.GetRotation() * FORWARD;
    float lean = std::abs(-world().system->GetGravity().NormalizedOr(-UP).Cross(up).Dot(ahead));
    brake *= (1 - lean) * (1 - lean);
  }
  static_cast<WheeledVehicleController *>(controller)->SetDriverInput(forward, v.steered, brake, v.handbrake);
}

}  // namespace

uint32_t vehicleCommand(const uint32_t *w) {
  uint32_t index = w[1] & INDEX_MASK;
  if (w[0] == VEHICLE) {
    add(w);
    return VEHICLE_WORDS + w[4] * WHEEL_WORDS;
  }
  Vehicle *vehicle = index < vehicles.size() && vehicles[index].constraint && vehicles[index].id == w[1] ? &vehicles[index] : nullptr;
  if (w[0] == UNVEHICLE) {
    if (vehicle) remove(*vehicle);
    return UNVEHICLE_WORDS;
  }
  if (vehicle) {
    vehicle->throttle = f32(w + 2), vehicle->brake = f32(w + 3), vehicle->steer = f32(w + 4), vehicle->handbrake = f32(w + 5);
    world().system->GetBodyInterfaceNoLock().ActivateBody(vehicle->constraint->GetVehicleBody()->GetID());
  }
  return DRIVE_WORDS;
}

void dropVehicles(uint32_t index) {
  for (Vehicle &vehicle : vehicles)
    if (vehicle.constraint && vehicle.body == index) remove(vehicle);
}

void driveVehicles(float dt) {
  if (dt <= 0) return;
  BodyInterface &bodies = world().system->GetBodyInterfaceNoLock();
  for (Vehicle &vehicle : vehicles) {
    if (!vehicle.constraint) continue;
    steer(vehicle, dt);
    // A vehicle driven, or whose wheel still turns back, stays awake.
    if (vehicle.throttle > 0 || vehicle.brake > 0 || vehicle.handbrake > 0 || vehicle.steered != 0)
      bodies.ActivateBody(vehicle.constraint->GetVehicleBody()->GetID());
  }
}

void writeVehicles() {
  state.clear();
  auto put = [](float value) {
    uint32_t word;
    std::memcpy(&word, &value, 4);
    state.push_back(word);
  };
  for (const Vehicle &vehicle : vehicles) {
    if (!vehicle.constraint) continue;
    const Body &body = *vehicle.constraint->GetVehicleBody();
    const auto *controller = vehicle.constraint->GetController();
    const VehicleEngine &engine = vehicle.kind == TRACKED ? static_cast<const TrackedVehicleController *>(controller)->GetEngine() : static_cast<const WheeledVehicleController *>(controller)->GetEngine();
    const VehicleTransmission &gearbox = vehicle.kind == TRACKED ? static_cast<const TrackedVehicleController *>(controller)->GetTransmission() : static_cast<const WheeledVehicleController *>(controller)->GetTransmission();
    uint32_t count = uint32_t(vehicle.constraint->GetWheels().size());
    state.push_back(vehicle.id);
    state.push_back(count);
    put((body.GetRotation().Conjugated() * body.GetLinearVelocity()).Dot(FORWARD));
    put(engine.GetCurrentRPM());
    put(float(gearbox.GetCurrentGear()));
    for (uint32_t i = 0; i < count; ++i) {
      Mat44 pose = vehicle.constraint->GetWheelLocalTransform(i, RIGHT, UP);
      Vec3 at = pose.GetTranslation();
      Quat turn = pose.GetQuaternion();
      for (float value : {at.GetX(), at.GetY(), at.GetZ(), turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW()}) put(value);
    }
  }
}

}  // namespace trillion

extern "C" {

/// The vehicles' state after the last step (`vehicleLayout.ts`): its words, then their count.
const uint32_t *jolt_vehicles() { return trillion::state.data(); }
uint32_t jolt_vehicle_words() { return uint32_t(trillion::state.size()); }

}  // extern "C"
